"""Database connection, initialisation, and migrations."""
import os
import logging
from pathlib import Path

import pymysql
import pymysql.cursors
import requests as http_requests

from config import HA_TOKEN, HA_API_URL

logger = logging.getLogger(__name__)

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
