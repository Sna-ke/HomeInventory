import os
import sys
import time
import uuid
import base64
import logging
import mimetypes
import io
from pathlib import Path

import pymysql
import requests as http_requests
from flask import Flask, request, jsonify, render_template, send_file, abort
from flask_cors import CORS
from PIL import Image

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

DB_NAME = os.environ.get("DB_NAME", "box_inventory")
UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", "/data/images"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_MIME = {"image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif"}
MAX_IMAGE_BYTES = 20 * 1024 * 1024  # 20 MB

DB_CONFIG = {
    "host": os.environ.get("DB_HOST", "core-mariadb"),
    "port": int(os.environ.get("DB_PORT", 3306)),
    "user": os.environ.get("DB_USER", "homeassistant"),
    "password": os.environ.get("DB_PASSWORD", ""),
    "database": DB_NAME,
    "charset": "utf8mb4",
    "cursorclass": pymysql.cursors.DictCursor,
}
DB_CONFIG_NO_DB = {k: v for k, v in DB_CONFIG.items() if k != "database"}


def get_db():
    return pymysql.connect(**DB_CONFIG)


def image_url(image_id):
    """Build an image URL that works both direct and through HA ingress."""
    ingress_path = request.headers.get("X-Ingress-Path", "").rstrip("/")
    return f"{ingress_path}/api/images/{image_id}"


def init_db():
    for attempt in range(10):
        try:
            conn = pymysql.connect(**DB_CONFIG_NO_DB)
            with conn.cursor() as cur:
                cur.execute(
                    f"CREATE DATABASE IF NOT EXISTS `{DB_NAME}` "
                    "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
                )
            conn.commit()
            conn.close()

            conn = get_db()
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS rooms (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        name VARCHAR(255) NOT NULL UNIQUE,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS categories (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        name VARCHAR(255) NOT NULL UNIQUE COLLATE utf8mb4_unicode_ci,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS boxes (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        box_number INT NOT NULL UNIQUE,
                        label VARCHAR(255),
                        description TEXT,
                        room_id INT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS items (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        name VARCHAR(255) NOT NULL,
                        category_id INT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS box_items (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        box_id INT NOT NULL,
                        item_id INT NOT NULL,
                        quantity INT NOT NULL DEFAULT 1,
                        notes TEXT,
                        FOREIGN KEY (box_id) REFERENCES boxes(id) ON DELETE CASCADE,
                        FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS box_number_seq (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        dummy TINYINT DEFAULT 0
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS images (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        filename VARCHAR(255) NOT NULL,
                        original_name VARCHAR(255),
                        mime_type VARCHAR(100),
                        entity_type ENUM('box','item') NOT NULL,
                        entity_id INT NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
            conn.commit()
            conn.close()
            logger.info("Database initialized successfully.")
            return
        except Exception as e:
            logger.warning(f"DB connection attempt {attempt+1}/10 failed: {e}")
            time.sleep(3)
    logger.error("Could not connect to database after 10 attempts. Exiting.")
    sys.exit(1)



def migrate_db():
    """Apply schema migrations for databases created by older versions."""
    conn = get_db()
    try:
        with conn.cursor() as cur:

            # Migration 1: boxes.description (added v1.1.0)
            cur.execute("""
                SELECT COUNT(*) as n FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = %s AND TABLE_NAME = 'boxes' AND COLUMN_NAME = 'description'
            """, (DB_NAME,))
            if cur.fetchone()["n"] == 0:
                logger.info("Migration: adding boxes.description column")
                cur.execute("ALTER TABLE boxes ADD COLUMN description TEXT AFTER label")

            # Migration 2: items.category TEXT -> normalized category_id FK (added v1.1.0)
            cur.execute("""
                SELECT COUNT(*) as n FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = %s AND TABLE_NAME = 'items' AND COLUMN_NAME = 'category'
            """, (DB_NAME,))
            if cur.fetchone()["n"] > 0:
                logger.info("Migration: normalizing items.category -> categories table")
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS categories (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        name VARCHAR(255) NOT NULL UNIQUE COLLATE utf8mb4_unicode_ci,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                cur.execute("""
                    SELECT COUNT(*) as n FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = %s AND TABLE_NAME = 'items' AND COLUMN_NAME = 'category_id'
                """, (DB_NAME,))
                if cur.fetchone()["n"] == 0:
                    cur.execute("ALTER TABLE items ADD COLUMN category_id INT AFTER name")
                # Seed categories from existing text values
                cur.execute("SELECT DISTINCT category FROM items WHERE category IS NOT NULL AND category != ''")
                for row in cur.fetchall():
                    cat_name = (row.get("category") or "").strip()
                    if cat_name:
                        cur.execute("INSERT IGNORE INTO categories (name) VALUES (%s)", (cat_name,))
                conn.commit()
                # Back-fill category_id
                cur.execute("""
                    UPDATE items i
                    JOIN categories c ON c.name = TRIM(i.category)
                    SET i.category_id = c.id
                    WHERE i.category IS NOT NULL AND i.category != ''
                """)
                conn.commit()
                cur.execute("ALTER TABLE items DROP COLUMN category")
                logger.info("Migration: items.category migration complete")

            # Migration 3: images table (added v1.1.0)
            cur.execute("""
                SELECT COUNT(*) as n FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = %s AND TABLE_NAME = 'images'
            """, (DB_NAME,))
            if cur.fetchone()["n"] == 0:
                logger.info("Migration: creating images table")
                cur.execute("""
                    CREATE TABLE images (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        filename VARCHAR(255) NOT NULL,
                        original_name VARCHAR(255),
                        mime_type VARCHAR(100),
                        entity_type ENUM('box','item') NOT NULL,
                        entity_id INT NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)

            # Migration 4: rooms.ha_area_id + ha_synced (added v1.6.0)
            cur.execute("""
                SELECT COUNT(*) as n FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = %s AND TABLE_NAME = 'rooms'
                AND COLUMN_NAME = 'ha_area_id'
            """, (DB_NAME,))
            if cur.fetchone()["n"] == 0:
                logger.info("Migration: adding rooms.ha_area_id and ha_synced columns")
                cur.execute("ALTER TABLE rooms ADD COLUMN ha_area_id VARCHAR(255) NULL UNIQUE AFTER name")
                cur.execute("ALTER TABLE rooms ADD COLUMN ha_synced TINYINT(1) NOT NULL DEFAULT 0 AFTER ha_area_id")

            # Migration 5: items.upc (added v1.9.2)
            cur.execute("""
                SELECT COUNT(*) as n FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = %s AND TABLE_NAME = 'items' AND COLUMN_NAME = 'upc'
            """, (DB_NAME,))
            if cur.fetchone()["n"] == 0:
                logger.info("Migration: adding items.upc column")
                cur.execute("ALTER TABLE items ADD COLUMN upc VARCHAR(64) NULL AFTER name")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_items_upc ON items(upc)")

        conn.commit()
        logger.info("Database migrations complete.")
    finally:
        conn.close()

def sync_ha_areas():
    """Fetch HA Areas and upsert into rooms table. Safe to call repeatedly.

    The area_registry has no direct REST endpoint. We use POST /api/template
    with a Jinja2 template that returns JSON — this is the official approach
    for add-ons that need area data without WebSocket.
    """
    if not HA_TOKEN:
        logger.info("HA_TOKEN not set — skipping HA area sync")
        return 0

    try:
        # Use tojson filter so HA handles all escaping.
        # Returns a JSON array of {"id": "...", "name": "..."} objects.
        template = (
            "{{ areas() | map(attribute='__str__') | list | tojson }}"
        )
        # Simpler: use a template that explicitly builds what we need
        template = (
            "{%- set ns = namespace(out=[]) -%}"
            "{%- for id in areas() -%}"
            "{%- set ns.out = ns.out + [{'id': id, 'name': area_name(id)}] -%}"
            "{%- endfor -%}"
            "{{ ns.out | tojson }}"
        )
        resp = http_requests.post(
            f"{HA_API_URL}/template",
            headers={"Authorization": f"Bearer {HA_TOKEN}", "Content-Type": "application/json"},
            json={"template": template},
            timeout=10,
        )
        resp.raise_for_status()
        import json as _json
        areas = _json.loads(resp.text)
    except Exception as e:
        logger.warning(f"HA area sync failed (fetch): {e}")
        return 0

    conn = get_db()
    synced = 0
    try:
        with conn.cursor() as cur:
            ha_area_ids = set()
            for area in areas:
                area_id = (area.get("id") or "").strip()
                name = (area.get("name") or "").strip()
                if not area_id or not name:
                    continue
                ha_area_ids.add(area_id)
                # Upsert: if ha_area_id exists update name; else insert new room
                cur.execute("SELECT id, name FROM rooms WHERE ha_area_id=%s", (area_id,))
                existing = cur.fetchone()
                if existing:
                    if existing["name"] != name:
                        cur.execute(
                            "UPDATE rooms SET name=%s, ha_synced=1 WHERE ha_area_id=%s",
                            (name, area_id)
                        )
                        logger.info(f"HA sync: renamed area '{existing['name']}' -> '{name}'")
                else:
                    # May already exist as a manually-created room with same name
                    cur.execute("SELECT id FROM rooms WHERE name=%s AND ha_area_id IS NULL", (name,))
                    manual = cur.fetchone()
                    if manual:
                        # Claim it — link the existing manual room to this HA area
                        cur.execute(
                            "UPDATE rooms SET ha_area_id=%s, ha_synced=1 WHERE id=%s",
                            (area_id, manual["id"])
                        )
                        logger.info(f"HA sync: linked existing room '{name}' to area {area_id}")
                    else:
                        try:
                            cur.execute(
                                "INSERT INTO rooms (name, ha_area_id, ha_synced) VALUES (%s,%s,1)",
                                (name, area_id)
                            )
                            logger.info(f"HA sync: added new area '{name}'")
                        except Exception:
                            pass  # duplicate name race — ignore
                synced += 1

            # Mark rooms whose HA area no longer exists
            if ha_area_ids:
                placeholders = ",".join(["%s"] * len(ha_area_ids))
                cur.execute(
                    f"UPDATE rooms SET ha_synced=0 WHERE ha_area_id IS NOT NULL "
                    f"AND ha_area_id NOT IN ({placeholders})",
                    list(ha_area_ids)
                )
            conn.commit()
    except Exception as e:
        logger.warning(f"HA area sync failed (db): {e}")
    finally:
        conn.close()

    logger.info(f"HA area sync complete: {synced} areas processed")
    return synced


def next_box_number():
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO box_number_seq (dummy) VALUES (0)")
            conn.commit()
            return cur.lastrowid
    finally:
        conn.close()


def get_or_create_category(conn, name):
    """Return category id for name, creating it if it doesn't exist."""
    name = name.strip()
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM categories WHERE name = %s", (name,))
        row = cur.fetchone()
        if row:
            return row["id"]
        cur.execute("INSERT INTO categories (name) VALUES (%s)", (name,))
        conn.commit()
        return cur.lastrowid


def images_for(conn, entity_type, entity_id):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, filename, original_name, mime_type, created_at "
            "FROM images WHERE entity_type=%s AND entity_id=%s ORDER BY created_at",
            (entity_type, entity_id)
        )
        rows = cur.fetchall()
    for r in rows:
        r["url"] = image_url(r["id"])
    return rows


# ── Categories ─────────────────────────────────────────────────────────────

@app.route("/api/categories", methods=["GET"])
def get_categories():
    q = request.args.get("q", "").strip()
    with_counts = request.args.get("counts", "0") == "1"
    conn = get_db()
    try:
        with conn.cursor() as cur:
            if with_counts:
                cur.execute("""
                    SELECT c.id, c.name, COUNT(i.id) as item_count
                    FROM categories c
                    LEFT JOIN items i ON i.category_id = c.id
                    GROUP BY c.id ORDER BY c.name
                """)
            elif q:
                cur.execute(
                    "SELECT id, name FROM categories WHERE name LIKE %s ORDER BY name LIMIT 20",
                    (f"%{q}%",)
                )
            else:
                cur.execute("SELECT id, name FROM categories ORDER BY name")
            return jsonify(cur.fetchall())
    finally:
        conn.close()


@app.route("/api/categories", methods=["POST"])
def create_category():
    data = request.json
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Name is required"}), 400
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO categories (name) VALUES (%s)", (name,))
            conn.commit()
            cur.execute("SELECT id, name FROM categories WHERE id=%s", (cur.lastrowid,))
            return jsonify(cur.fetchone()), 201
    except pymysql.err.IntegrityError:
        return jsonify({"error": "A category with that name already exists"}), 409
    finally:
        conn.close()


@app.route("/api/categories/<int:cat_id>", methods=["PUT"])
def update_category(cat_id):
    data = request.json
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Name is required"}), 400
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("UPDATE categories SET name=%s WHERE id=%s", (name, cat_id))
            conn.commit()
            cur.execute("SELECT id, name FROM categories WHERE id=%s", (cat_id,))
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Not found"}), 404
            return jsonify(row)
    except pymysql.err.IntegrityError:
        return jsonify({"error": "A category with that name already exists"}), 409
    finally:
        conn.close()


@app.route("/api/categories/<int:cat_id>", methods=["DELETE"])
def delete_category(cat_id):
    # Optional: reassign items to another category before deleting
    reassign_to = request.args.get("reassign_to")  # category id or blank = set null
    conn = get_db()
    try:
        with conn.cursor() as cur:
            if reassign_to:
                cur.execute(
                    "UPDATE items SET category_id=%s WHERE category_id=%s",
                    (int(reassign_to), cat_id)
                )
            else:
                cur.execute("UPDATE items SET category_id=NULL WHERE category_id=%s", (cat_id,))
            cur.execute("DELETE FROM categories WHERE id=%s", (cat_id,))
            conn.commit()
            return jsonify({"ok": True})
    finally:
        conn.close()


@app.route("/api/categories/<int:cat_id>/items", methods=["GET"])
def get_category_items(cat_id):
    """Items in a category, with their box/location details."""
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT i.id, i.name,
                       bi.id as box_item_id, bi.quantity,
                       b.id as box_id, b.box_number, b.label,
                       r.name as room_name
                FROM items i
                LEFT JOIN box_items bi ON bi.item_id = i.id
                LEFT JOIN boxes b ON b.id = bi.box_id
                LEFT JOIN rooms r ON r.id = b.room_id
                WHERE i.category_id = %s
                ORDER BY i.name, b.box_number
            """, (cat_id,))
            rows = cur.fetchall()
            # Group by item
            items = {}
            for row in rows:
                iid = row["id"]
                if iid not in items:
                    items[iid] = {"id": iid, "name": row["name"], "boxes": []}
                if row["box_id"]:
                    items[iid]["boxes"].append({
                        "box_item_id": row["box_item_id"],
                        "box_id": row["box_id"],
                        "box_number": row["box_number"],
                        "label": row["label"],
                        "room_name": row["room_name"],
                        "quantity": row["quantity"],
                    })
            return jsonify(list(items.values()))
    finally:
        conn.close()


# ── Rooms ──────────────────────────────────────────────────────────────────

@app.route("/api/rooms", methods=["GET"])
def get_rooms():
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT r.id, r.name, r.ha_area_id, r.ha_synced,
                       COUNT(b.id) as box_count
                FROM rooms r
                LEFT JOIN boxes b ON b.room_id = r.id
                GROUP BY r.id
                ORDER BY r.name
            """)
            return jsonify(cur.fetchall())
    finally:
        conn.close()


@app.route("/api/rooms/<int:room_id>/boxes", methods=["GET"])
def get_room_boxes(room_id):
    """Boxes in a room with item counts — for expand row on rooms page."""
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT b.id, b.box_number, b.label, b.description,
                       COUNT(bi.id) as item_count,
                       COALESCE(SUM(bi.quantity), 0) as total_qty,
                       (SELECT img.id
                        FROM images img WHERE img.entity_type='box' AND img.entity_id=b.id
                        ORDER BY img.created_at LIMIT 1) as thumb_id
                FROM boxes b
                LEFT JOIN box_items bi ON bi.box_id = b.id
                WHERE b.room_id = %s
                GROUP BY b.id
                ORDER BY b.box_number
            """, (room_id,))
            rows = cur.fetchall()
            for row in rows:
                tid = row.pop("thumb_id", None)
                row["thumb_url"] = image_url(tid) if tid else None
            return jsonify(rows)
    finally:
        conn.close()


@app.route("/api/rooms/sync-ha", methods=["POST"])
def trigger_ha_sync():
    """Manually trigger HA area sync from the UI."""
    count = sync_ha_areas()
    return jsonify({"ok": True, "synced": count})


@app.route("/api/rooms", methods=["POST"])
def create_room():
    data = request.json
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Room name is required"}), 400
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO rooms (name, ha_synced) VALUES (%s, 0)", (name,))
            conn.commit()
            cur.execute("SELECT * FROM rooms WHERE id = %s", (cur.lastrowid,))
            return jsonify(cur.fetchone()), 201
    except pymysql.err.IntegrityError:
        return jsonify({"error": "A room with that name already exists"}), 409
    finally:
        conn.close()


@app.route("/api/rooms/<int:room_id>", methods=["PUT"])
def update_room(room_id):
    data = request.json
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Room name is required"}), 400
    conn = get_db()
    try:
        with conn.cursor() as cur:
            # Don't allow renaming HA-synced areas from the app
            cur.execute("SELECT ha_synced, ha_area_id FROM rooms WHERE id=%s", (room_id,))
            row = cur.fetchone()
            if row and row["ha_synced"] and row["ha_area_id"]:
                return jsonify({"error": "This area is managed by Home Assistant. Rename it in HA."}), 403
            cur.execute("UPDATE rooms SET name=%s WHERE id=%s", (name, room_id))
            conn.commit()
            cur.execute("SELECT * FROM rooms WHERE id=%s", (room_id,))
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Not found"}), 404
            return jsonify(row)
    finally:
        conn.close()


@app.route("/api/rooms/<int:room_id>", methods=["DELETE"])
def delete_room(room_id):
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT ha_synced, ha_area_id FROM rooms WHERE id=%s", (room_id,))
            row = cur.fetchone()
            if row and row["ha_synced"] and row["ha_area_id"]:
                return jsonify({"error": "This area is managed by Home Assistant. Remove it in HA."}), 403
            cur.execute("DELETE FROM rooms WHERE id=%s", (room_id,))
            conn.commit()
            return jsonify({"ok": True})
    finally:
        conn.close()


# ── Boxes ──────────────────────────────────────────────────────────────────

@app.route("/api/boxes", methods=["GET"])
def get_boxes():
    room_id = request.args.get("room_id")
    conn = get_db()
    try:
        with conn.cursor() as cur:
            sql = """
                SELECT b.*, r.name as room_name,
                       COUNT(DISTINCT bi.id) as item_count,
                       COALESCE(SUM(bi.quantity), 0) as total_qty
                FROM boxes b
                LEFT JOIN rooms r ON r.id = b.room_id
                LEFT JOIN box_items bi ON bi.box_id = b.id
            """
            params = []
            if room_id:
                sql += " WHERE b.room_id = %s"
                params.append(room_id)
            sql += " GROUP BY b.id ORDER BY b.box_number"
            cur.execute(sql, params)
            boxes = cur.fetchall()
        # Attach thumbnail data for card display
        for box in boxes:
            cur2 = conn.cursor()
            # First preference: box's own photos
            cur2.execute(
                "SELECT id FROM images WHERE entity_type='box' AND entity_id=%s ORDER BY created_at LIMIT 1",
                (box["id"],)
            )
            img = cur2.fetchone()
            if img:
                box["thumb_url"] = image_url(img["id"])
                box["collage_urls"] = None
            else:
                box["thumb_url"] = None
                # Fallback: up to 9 item photos from items in this box
                cur2.execute("""
                    SELECT DISTINCT img.id
                    FROM images img
                    JOIN box_items bi ON bi.item_id = img.entity_id
                    WHERE img.entity_type = 'item' AND bi.box_id = %s
                    ORDER BY img.created_at
                    LIMIT 9
                """, (box["id"],))
                item_imgs = cur2.fetchall()
                box["collage_urls"] = [image_url(r["id"]) for r in item_imgs] if item_imgs else None
            cur2.close()
        return jsonify(boxes)
    finally:
        conn.close()


@app.route("/api/boxes/<int:box_id>", methods=["GET"])
def get_box(box_id):
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT b.*, r.name as room_name
                FROM boxes b
                LEFT JOIN rooms r ON r.id = b.room_id
                WHERE b.id = %s
            """, (box_id,))
            box = cur.fetchone()
            if not box:
                return jsonify({"error": "Not found"}), 404
            cur.execute("""
                SELECT bi.id as box_item_id, bi.quantity, bi.notes,
                       i.id as item_id, i.name,
                       c.id as category_id, c.name as category,
                       (SELECT img.id
                        FROM images img
                        WHERE img.entity_type = 'item' AND img.entity_id = i.id
                        ORDER BY img.created_at LIMIT 1) as thumb_id
                FROM box_items bi
                JOIN items i ON i.id = bi.item_id
                LEFT JOIN categories c ON c.id = i.category_id
                WHERE bi.box_id = %s
                ORDER BY c.name, i.name
            """, (box_id,))
            items = cur.fetchall()
            for item in items:
                tid = item.pop("thumb_id", None)
                item["thumb_url"] = image_url(tid) if tid else None
            box["items"] = items
            box["images"] = images_for(conn, "box", box_id)
            return jsonify(box)
    finally:
        conn.close()


@app.route("/api/boxes", methods=["POST"])
def create_box():
    data = request.json
    label = (data.get("label") or "").strip() or None
    description = (data.get("description") or "").strip() or None
    room_id = data.get("room_id") or None
    box_number = next_box_number()
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO boxes (box_number, label, description, room_id) VALUES (%s,%s,%s,%s)",
                (box_number, label, description, room_id)
            )
            conn.commit()
            box_id = cur.lastrowid
            cur.execute("""
                SELECT b.*, r.name as room_name
                FROM boxes b LEFT JOIN rooms r ON r.id=b.room_id
                WHERE b.id=%s
            """, (box_id,))
            return jsonify(cur.fetchone()), 201
    finally:
        conn.close()


@app.route("/api/boxes/<int:box_id>", methods=["PUT"])
def update_box(box_id):
    data = request.json
    label = (data.get("label") or "").strip() or None
    description = (data.get("description") or "").strip() or None
    room_id = data.get("room_id") or None
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE boxes SET label=%s, description=%s, room_id=%s WHERE id=%s",
                (label, description, room_id, box_id)
            )
            conn.commit()
            cur.execute("""
                SELECT b.*, r.name as room_name
                FROM boxes b LEFT JOIN rooms r ON r.id=b.room_id
                WHERE b.id=%s
            """, (box_id,))
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Not found"}), 404
            return jsonify(row)
    finally:
        conn.close()


@app.route("/api/boxes/<int:box_id>", methods=["DELETE"])
def delete_box(box_id):
    # Delete associated image files from disk
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT filename FROM images WHERE entity_type='box' AND entity_id=%s", (box_id,))
            for row in cur.fetchall():
                _delete_image_file(row["filename"])
            cur.execute("DELETE FROM boxes WHERE id=%s", (box_id,))
            conn.commit()
            return jsonify({"ok": True})
    finally:
        conn.close()


# ── Items ──────────────────────────────────────────────────────────────────

@app.route("/api/items", methods=["GET"])
def get_items():
    q = request.args.get("q", "").strip()
    conn = get_db()
    try:
        with conn.cursor() as cur:
            base = """
                SELECT i.id, i.name, i.upc, c.id as category_id, c.name as category,
                       GROUP_CONCAT(b.box_number ORDER BY b.box_number) as in_boxes
                FROM items i
                LEFT JOIN categories c ON c.id = i.category_id
                LEFT JOIN box_items bi ON bi.item_id = i.id
                LEFT JOIN boxes b ON b.id = bi.box_id
            """
            if q:
                cur.execute(
                    base + " WHERE i.name LIKE %s OR c.name LIKE %s GROUP BY i.id ORDER BY c.name, i.name",
                    (f"%{q}%", f"%{q}%")
                )
            else:
                cur.execute(base + " GROUP BY i.id ORDER BY c.name, i.name")
            return jsonify(cur.fetchall())
    finally:
        conn.close()


@app.route("/api/items", methods=["POST"])
def create_item():
    data = request.json
    name = (data.get("name") or "").strip()
    category_name = (data.get("category") or "").strip()
    upc = (data.get("upc") or "").strip() or None
    if not name:
        return jsonify({"error": "Item name is required"}), 400
    conn = get_db()
    try:
        category_id = get_or_create_category(conn, category_name) if category_name else None
        with conn.cursor() as cur:
            cur.execute("INSERT INTO items (name, category_id, upc) VALUES (%s,%s,%s)", (name, category_id, upc))
            conn.commit()
            item_id = cur.lastrowid
            cur.execute("""
                SELECT i.id, i.name, i.upc, c.id as category_id, c.name as category
                FROM items i LEFT JOIN categories c ON c.id=i.category_id
                WHERE i.id=%s
            """, (item_id,))
            return jsonify(cur.fetchone()), 201
    finally:
        conn.close()


@app.route("/api/items/<int:item_id>", methods=["PUT"])
def update_item(item_id):
    data = request.json
    name = (data.get("name") or "").strip()
    category_name = (data.get("category") or "").strip()
    # upc=None means "don't change"; upc="" means "clear it"
    update_upc = "upc" in data
    upc = (data.get("upc") or "").strip() or None
    if not name:
        return jsonify({"error": "Item name is required"}), 400
    conn = get_db()
    try:
        category_id = get_or_create_category(conn, category_name) if category_name else None
        with conn.cursor() as cur:
            if update_upc:
                cur.execute("UPDATE items SET name=%s, category_id=%s, upc=%s WHERE id=%s",
                            (name, category_id, upc, item_id))
            else:
                cur.execute("UPDATE items SET name=%s, category_id=%s WHERE id=%s",
                            (name, category_id, item_id))
            conn.commit()
            cur.execute("""
                SELECT i.id, i.name, i.upc, c.id as category_id, c.name as category
                FROM items i LEFT JOIN categories c ON c.id=i.category_id
                WHERE i.id=%s
            """, (item_id,))
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Not found"}), 404
            return jsonify(row)
    finally:
        conn.close()


@app.route("/api/items/<int:item_id>", methods=["DELETE"])
def delete_item(item_id):
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT filename FROM images WHERE entity_type='item' AND entity_id=%s", (item_id,))
            for row in cur.fetchall():
                _delete_image_file(row["filename"])
            cur.execute("DELETE FROM items WHERE id=%s", (item_id,))
            conn.commit()
            return jsonify({"ok": True})
    finally:
        conn.close()


@app.route("/api/items/<int:item_id>", methods=["GET"])
def get_item(item_id):
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT i.id, i.name, c.id as category_id, c.name as category
                FROM items i LEFT JOIN categories c ON c.id=i.category_id
                WHERE i.id=%s
            """, (item_id,))
            item = cur.fetchone()
            if not item:
                return jsonify({"error": "Not found"}), 404
            # Include box locations
            cur.execute("""
                SELECT bi.id as box_item_id, bi.quantity, bi.notes,
                       b.id as box_id, b.box_number, b.label,
                       r.name as room_name
                FROM box_items bi
                JOIN boxes b ON b.id = bi.box_id
                LEFT JOIN rooms r ON r.id = b.room_id
                WHERE bi.item_id = %s
                ORDER BY b.box_number
            """, (item_id,))
            item["boxes"] = cur.fetchall()
            item["images"] = images_for(conn, "item", item_id)
            return jsonify(item)
    finally:
        conn.close()


# ── Box Items ──────────────────────────────────────────────────────────────

@app.route("/api/boxes/<int:box_id>/items", methods=["POST"])
def add_item_to_box(box_id):
    data = request.json
    item_id = data.get("item_id")
    quantity = int(data.get("quantity") or 1)
    notes = (data.get("notes") or "").strip() or None
    if not item_id:
        return jsonify({"error": "item_id is required"}), 400
    conn = get_db()
    try:
        with conn.cursor() as cur:
            # Check for existing entry with the same item and notes in this box.
            # If found, increment the quantity instead of inserting a duplicate.
            cur.execute(
                "SELECT id, quantity FROM box_items "
                "WHERE box_id=%s AND item_id=%s AND (notes=%s OR (notes IS NULL AND %s IS NULL))",
                (box_id, item_id, notes, notes)
            )
            existing = cur.fetchone()
            if existing:
                new_qty = existing["quantity"] + quantity
                cur.execute(
                    "UPDATE box_items SET quantity=%s WHERE id=%s",
                    (new_qty, existing["id"])
                )
                conn.commit()
                return jsonify({"ok": True, "id": existing["id"], "incremented": True, "quantity": new_qty}), 200
            else:
                cur.execute(
                    "INSERT INTO box_items (box_id, item_id, quantity, notes) VALUES (%s,%s,%s,%s)",
                    (box_id, item_id, quantity, notes)
                )
                conn.commit()
                return jsonify({"ok": True, "id": cur.lastrowid, "incremented": False}), 201
    finally:
        conn.close()


@app.route("/api/box-items/<int:box_item_id>", methods=["PUT"])
def update_box_item(box_item_id):
    data = request.json
    quantity = int(data.get("quantity") or 1)
    notes = (data.get("notes") or "").strip() or None
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE box_items SET quantity=%s, notes=%s WHERE id=%s",
                (quantity, notes, box_item_id)
            )
            conn.commit()
            return jsonify({"ok": True})
    finally:
        conn.close()


@app.route("/api/box-items/<int:box_item_id>/move", methods=["POST"])
def move_box_item(box_item_id):
    """Move a box_item (or subset of its quantity) to a different box."""
    data = request.json
    target_box_id = data.get("target_box_id")
    if not target_box_id:
        return jsonify({"error": "target_box_id is required"}), 400
    target_box_id = int(target_box_id)
    move_qty = data.get("quantity")  # None = move all
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM box_items WHERE id=%s", (box_item_id,))
            src = cur.fetchone()
            if not src:
                return jsonify({"error": "Not found"}), 404
            if src["box_id"] == target_box_id:
                return jsonify({"error": "Already in that box"}), 400

            # Resolve quantity to move
            src_qty = src["quantity"]
            qty_to_move = int(move_qty) if move_qty is not None else src_qty
            qty_to_move = max(1, min(qty_to_move, src_qty))
            qty_remaining = src_qty - qty_to_move

            # Check if target box already has this item with the same notes
            cur.execute(
                "SELECT id, quantity FROM box_items "
                "WHERE box_id=%s AND item_id=%s AND (notes=%s OR (notes IS NULL AND %s IS NULL))",
                (target_box_id, src["item_id"], src["notes"], src["notes"])
            )
            existing = cur.fetchone()

            if existing:
                # Merge into existing target entry
                cur.execute(
                    "UPDATE box_items SET quantity=%s WHERE id=%s",
                    (existing["quantity"] + qty_to_move, existing["id"])
                )
            else:
                # Insert new entry in target box
                cur.execute(
                    "INSERT INTO box_items (box_id, item_id, quantity, notes) VALUES (%s,%s,%s,%s)",
                    (target_box_id, src["item_id"], qty_to_move, src["notes"])
                )

            # Update or remove source entry
            if qty_remaining > 0:
                cur.execute("UPDATE box_items SET quantity=%s WHERE id=%s", (qty_remaining, box_item_id))
            else:
                cur.execute("DELETE FROM box_items WHERE id=%s", (box_item_id,))

            conn.commit()
            return jsonify({
                "ok": True,
                "merged": existing is not None,
                "qty_moved": qty_to_move,
                "qty_remaining": qty_remaining,
            })
    finally:
        conn.close()


@app.route("/api/box-items/<int:box_item_id>", methods=["DELETE"])
def remove_box_item(box_item_id):
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM box_items WHERE id=%s", (box_item_id,))
            conn.commit()
            return jsonify({"ok": True})
    finally:
        conn.close()


# ── Images ─────────────────────────────────────────────────────────────────

def _delete_image_file(filename):
    try:
        (UPLOAD_DIR / filename).unlink(missing_ok=True)
    except Exception as e:
        logger.warning(f"Could not delete image file {filename}: {e}")


@app.route("/api/images/upload", methods=["POST"])
def upload_image():
    entity_type = request.form.get("entity_type")  # 'box' or 'item'
    entity_id = request.form.get("entity_id")
    if entity_type not in ("box", "item") or not entity_id:
        return jsonify({"error": "entity_type (box|item) and entity_id are required"}), 400
    entity_id = int(entity_id)

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    f = request.files["file"]
    if not f.filename:
        return jsonify({"error": "Empty filename"}), 400

    mime = f.mimetype or mimetypes.guess_type(f.filename)[0] or ""
    if mime not in ALLOWED_MIME:
        return jsonify({"error": f"Unsupported image type: {mime}"}), 415

    data = f.read()
    if len(data) > MAX_IMAGE_BYTES:
        return jsonify({"error": "Image too large (max 20 MB)"}), 413

    ext = Path(f.filename).suffix.lower() or ".jpg"
    filename = f"{uuid.uuid4().hex}{ext}"
    (UPLOAD_DIR / filename).write_bytes(data)

    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO images (filename, original_name, mime_type, entity_type, entity_id) "
                "VALUES (%s,%s,%s,%s,%s)",
                (filename, f.filename, mime, entity_type, entity_id)
            )
            conn.commit()
            image_id = cur.lastrowid
        return jsonify({"id": image_id, "url": image_url(image_id)}), 201
    finally:
        conn.close()


@app.route("/api/images/<int:image_id>", methods=["GET"])
def serve_image(image_id):
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT filename, mime_type FROM images WHERE id=%s", (image_id,))
            row = cur.fetchone()
    finally:
        conn.close()
    if not row:
        abort(404)
    path = UPLOAD_DIR / row["filename"]
    if not path.exists():
        abort(404)
    return send_file(path, mimetype=row["mime_type"])


@app.route("/api/images/<int:image_id>", methods=["DELETE"])
def delete_image(image_id):
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT filename FROM images WHERE id=%s", (image_id,))
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Not found"}), 404
            _delete_image_file(row["filename"])
            cur.execute("DELETE FROM images WHERE id=%s", (image_id,))
            conn.commit()
            return jsonify({"ok": True})
    finally:
        conn.close()


# ── Search ─────────────────────────────────────────────────────────────────

@app.route("/api/search", methods=["GET"])
def search():
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify([])
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT DISTINCT b.id as box_id, b.box_number, b.label,
                       r.name as room_name,
                       i.name as item_name, c.name as category,
                       bi.quantity, bi.notes
                FROM boxes b
                LEFT JOIN rooms r ON r.id = b.room_id
                LEFT JOIN box_items bi ON bi.box_id = b.id
                LEFT JOIN items i ON i.id = bi.item_id
                LEFT JOIN categories c ON c.id = i.category_id
                WHERE i.name LIKE %s OR c.name LIKE %s OR b.label LIKE %s
                ORDER BY b.box_number
            """, (f"%{q}%", f"%{q}%", f"%{q}%"))
            return jsonify(cur.fetchall())
    finally:
        conn.close()


# ── Vision / Item Identification ──────────────────────────────────────────

HA_TOKEN = os.environ.get("HA_TOKEN", "").strip()
HA_API_URL = "http://supervisor/core/api"

VISION_BACKEND = os.environ.get("VISION_BACKEND", "none").lower()
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://homeassistant.local:11434").rstrip("/")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llava").strip()

IDENTIFY_PROMPT = (
    "You are helping label moving boxes. Look at this photo and identify the "
    "physical item(s) visible. Return ONLY a JSON array of up to 5 short item "
    "name strings, most specific first. Each name should be 1-4 words, suitable "
    "as a box inventory label (e.g. 'Rice cooker', 'Coffee mug', 'HDMI cable'). "
    "No explanations, no markdown — just the raw JSON array."
)

MAX_IDENTIFY_BYTES = 5 * 1024 * 1024  # 5 MB after resize


def compress_image_for_vision(file_bytes: bytes, mime: str) -> tuple[bytes, str]:
    """Resize and compress image to keep API costs low. Returns (bytes, mime)."""
    try:
        img = Image.open(io.BytesIO(file_bytes))
        img = img.convert("RGB")
        # Resize so longest edge <= 1024px
        w, h = img.size
        if max(w, h) > 1024:
            scale = 1024 / max(w, h)
            img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=82, optimize=True)
        return buf.getvalue(), "image/jpeg"
    except Exception as e:
        logger.warning(f"Image compression failed: {e}, sending original")
        return file_bytes, mime


def parse_vision_response(raw: str) -> list[str]:
    """Robustly extract a list of item name strings from a model response.

    Handles: clean JSON arrays, markdown-fenced JSON, prose with bullet/numbered
    lists, newline-separated names, and single-item responses.
    """
    import json, re

    text = raw.strip()

    # 1. Strip markdown code fences (```json ... ``` or ``` ... ```)
    text = re.sub(r"```(?:json)?\s*", "", text).strip()
    text = text.strip("`").strip()

    # 2. Try direct JSON parse
    try:
        result = json.loads(text)
        if isinstance(result, list):
            return [str(s).strip() for s in result if str(s).strip()][:5]
        if isinstance(result, str):
            return [result.strip()] if result.strip() else []
    except (json.JSONDecodeError, ValueError):
        pass

    # 3. Try to extract a JSON array embedded anywhere in the text
    m = re.search(r"\[.*?\]", text, re.DOTALL)
    if m:
        try:
            result = json.loads(m.group(0))
            if isinstance(result, list):
                return [str(s).strip() for s in result if str(s).strip()][:5]
        except (json.JSONDecodeError, ValueError):
            pass

    # 4. Fall back: split on newlines, strip bullets/numbers/quotes
    lines = []
    for line in text.splitlines():
        line = line.strip()
        # Remove leading bullets, numbers, dashes, asterisks
        line = re.sub(r"^[\d]+[.)]\s*", "", line)
        line = re.sub(r"^[-*•]\s*", "", line)
        # Remove surrounding quotes
        line = line.strip('"\'')
        # Skip empty lines or lines that look like prose (long sentences)
        if line and len(line) <= 80 and not line.endswith(":"):
            lines.append(line)
    if lines:
        return lines[:5]

    return []


def identify_via_anthropic(img_bytes: bytes, mime: str, prompt: str = None) -> list[str]:
    import anthropic
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    b64 = base64.standard_b64encode(img_bytes).decode()
    msg = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=256,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}},
                {"type": "text", "text": prompt or IDENTIFY_PROMPT},
            ],
        }],
    )
    raw = msg.content[0].text.strip()
    return parse_vision_response(raw)


def get_ollama_models() -> list[str]:
    """Return list of model names available on the Ollama server, or [] on error."""
    try:
        resp = http_requests.get(f"{OLLAMA_URL}/api/tags", timeout=5)
        resp.raise_for_status()
        return [m.get("name", "") for m in resp.json().get("models", [])]
    except Exception:
        return []


def identify_via_ollama(img_bytes: bytes, mime: str, prompt: str = None) -> list[str]:
    import json
    b64 = base64.standard_b64encode(img_bytes).decode()

    # Check model exists before trying — gives a friendlier error than a raw 404
    available = get_ollama_models()
    # Ollama model names may include a tag (e.g. "llava:latest"); match on prefix
    model_found = any(
        m == OLLAMA_MODEL or m.startswith(OLLAMA_MODEL + ":") or OLLAMA_MODEL.startswith(m.split(":")[0])
        for m in available
    )
    if available and not model_found:
        raise ValueError(
            f"Model '{OLLAMA_MODEL}' is not installed on your Ollama server. "
            f"Available models: {', '.join(available) or 'none'}. "
            f"Run: ollama pull {OLLAMA_MODEL}"
        )

    resp = http_requests.post(
        f"{OLLAMA_URL}/api/generate",
        json={
            "model": OLLAMA_MODEL,
            "prompt": prompt or IDENTIFY_PROMPT,
            "images": [b64],
            "stream": False,
            "options": {"temperature": 0.1},
        },
        timeout=120,
    )
    if resp.status_code == 404:
        raise ValueError(
            f"Model '{OLLAMA_MODEL}' not found on Ollama server at {OLLAMA_URL}. "
            f"Run: ollama pull {OLLAMA_MODEL}"
        )
    resp.raise_for_status()
    raw = resp.json().get("response", "").strip()
    return parse_vision_response(raw)


@app.route("/api/vision-config", methods=["GET"])
def vision_config():
    """Let the frontend know what's configured, checking Ollama model availability."""
    backend = VISION_BACKEND
    ready = False
    warning = None
    available_models = []

    if backend == "anthropic" and ANTHROPIC_API_KEY:
        ready = True
    elif backend == "ollama" and OLLAMA_URL:
        available_models = get_ollama_models()
        if not available_models:
            # Can't reach server at all
            warning = f"Cannot reach Ollama at {OLLAMA_URL}"
        else:
            model_found = any(
                m == OLLAMA_MODEL or m.startswith(OLLAMA_MODEL + ":")
                or OLLAMA_MODEL.startswith(m.split(":")[0])
                for m in available_models
            )
            if model_found:
                ready = True
            else:
                warning = (
                    f"Model '{OLLAMA_MODEL}' is not installed. "
                    f"Run: ollama pull {OLLAMA_MODEL}  "
                    f"(available: {', '.join(available_models[:5])})"
                )

    return jsonify({
        "backend": backend,
        "ready": ready,
        "model": OLLAMA_MODEL if backend == "ollama" else None,
        "available_models": available_models,
        "warning": warning,
    })


BARCODE_PROMPT = (
    "You are helping label moving boxes. Look at this photo and identify the barcode. "
    "Look up the product name for that barcode and return ONLY a JSON array of up to 3 "
    "short product name strings, most specific first. Each name should be 1-5 words suitable "
    "as a box inventory label (e.g. 'Nespresso Vertuo Next', 'Dyson V11 Vacuum', 'Kindle Paperwhite'). "
    "No explanations, no markdown — just the raw JSON array. "
    "If you cannot read a barcode or identify the product, return []."
)

@app.route("/api/identify", methods=["POST"])
def identify_item():
    if VISION_BACKEND == "none":
        return jsonify({"error": "Vision backend not configured"}), 503

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    mode = request.form.get("mode", "image")  # "image" or "barcode"
    f = request.files["file"]
    mime = f.mimetype or mimetypes.guess_type(f.filename or "")[0] or "image/jpeg"
    raw_bytes = f.read()

    if len(raw_bytes) > 20 * 1024 * 1024:
        return jsonify({"error": "Image too large (max 20 MB)"}), 413

    img_bytes, img_mime = compress_image_for_vision(raw_bytes, mime)

    prompt = BARCODE_PROMPT if mode == "barcode" else IDENTIFY_PROMPT
    try:
        if VISION_BACKEND == "anthropic":
            if not ANTHROPIC_API_KEY:
                return jsonify({"error": "Anthropic API key not set"}), 503
            names = identify_via_anthropic(img_bytes, img_mime, prompt)
        elif VISION_BACKEND == "ollama":
            names = identify_via_ollama(img_bytes, img_mime, prompt)
        else:
            return jsonify({"error": "Unknown vision backend"}), 503

        if not isinstance(names, list):
            raise ValueError("Model did not return a list")
        # Sanitise — keep only strings, max 5, max 60 chars each
        names = [str(n).strip()[:60] for n in names if n][:5]
        return jsonify({"suggestions": names})

    except Exception as e:
        logger.error(f"Vision identify error ({VISION_BACKEND}): {e}")
        return jsonify({"error": f"Identification failed: {str(e)}"}), 500


# ── UPC Lookup ────────────────────────────────────────────────────────────

@app.route("/api/items/find-by-name", methods=["GET"])
def find_item_by_name():
    """Find existing items matching a name (case-insensitive).
    Used by barcode flow to detect merge candidates.
    Returns items with their UPC so the frontend can decide:
      - no UPC: offer to merge (save UPC to existing item)
      - different UPC: keep separate (different product variant)
      - same UPC: already merged, use directly
    """
    name = (request.args.get("name") or "").strip()
    if not name:
        return jsonify([])
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT i.id, i.name, i.upc, c.name as category
                FROM items i
                LEFT JOIN categories c ON c.id = i.category_id
                WHERE LOWER(i.name) = LOWER(%s)
            """, (name,))
            return jsonify(cur.fetchall())
    finally:
        conn.close()


@app.route("/api/upc-lookup", methods=["GET"])
def upc_lookup():
    """Look up a UPC. Checks local item DB first, then external APIs."""
    upc_raw = (request.args.get("upc") or "").strip()
    if not upc_raw:
        return jsonify({"error": "Invalid UPC"}), 400
    # Normalise: strip leading zeros for external lookups but keep raw for DB
    upc = upc_raw.lstrip("0") or upc_raw
    if not upc.isdigit():
        return jsonify({"error": "Invalid UPC"}), 400

    # ── 0. Local DB lookup ────────────────────────────────────────────────────
    conn = get_db()
    local_items = []
    try:
        with conn.cursor() as cur:
            # Match on both raw and normalised (leading zeros stripped)
            cur.execute("""
                SELECT i.id, i.name, i.upc, c.name as category
                FROM items i
                LEFT JOIN categories c ON c.id = i.category_id
                WHERE i.upc = %s OR i.upc = %s
            """, (upc_raw, upc))
            local_items = cur.fetchall()
    finally:
        conn.close()

    if local_items:
        return jsonify({
            "upc": upc,
            "source": "local",
            "items": local_items,          # full item objects with id
            "names": [i["name"] for i in local_items],
        })

    names = []

    # ── 1. Open Food Facts (great for grocery/packaged goods) ────────────────
    try:
        r = http_requests.get(
            f"https://world.openfoodfacts.org/api/v0/product/{upc}.json",
            headers={"User-Agent": "BoxInventoryTracker/1.0"},
            timeout=6,
        )
        if r.status_code == 200:
            data = r.json()
            if data.get("status") == 1:
                p = data.get("product", {})
                # Prefer product_name, fall back to generic name or brands
                name = (p.get("product_name") or p.get("generic_name") or "").strip()
                brand = (p.get("brands") or "").split(",")[0].strip()
                if name:
                    names.append(f"{brand} {name}".strip() if brand and brand.lower() not in name.lower() else name)
                elif brand:
                    names.append(brand)
    except Exception as e:
        logger.debug(f"Open Food Facts lookup failed: {e}")

    # ── 2. UPCitemdb (broader range: electronics, books, household) ──────────
    if not names:
        try:
            r = http_requests.get(
                f"https://api.upcitemdb.com/prod/trial/lookup?upc={upc}",
                headers={"User-Agent": "BoxInventoryTracker/1.0"},
                timeout=6,
            )
            if r.status_code == 200:
                data = r.json()
                for item in (data.get("items") or [])[:3]:
                    title = (item.get("title") or "").strip()
                    if title:
                        names.append(title)
        except Exception as e:
            logger.debug(f"UPCitemdb lookup failed: {e}")

    return jsonify({"upc": upc, "source": "external", "items": [], "names": names[:5]})


# ── Frontend ───────────────────────────────────────────────────────────────

@app.route("/")
def index():
    # HA ingress injects X-Ingress-Path (e.g. /api/hassio_ingress/abc123)
    # We pass it to the template so the frontend can prefix all API calls.
    ingress_path = request.headers.get("X-Ingress-Path", "").rstrip("/")
    return render_template("index.html", ingress_path=ingress_path)


if __name__ == "__main__":
    init_db()
    migrate_db()
    sync_ha_areas()
    app.run(host="0.0.0.0", port=5000, debug=False)
