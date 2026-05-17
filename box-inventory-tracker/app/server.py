import os
import sys
import time
import logging
import pymysql
from flask import Flask, request, jsonify, render_template
from flask_cors import CORS

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

DB_NAME = os.environ.get("DB_NAME", "box_inventory")

DB_CONFIG = {
    "host": os.environ.get("DB_HOST", "core-mariadb"),
    "port": int(os.environ.get("DB_PORT", 3306)),
    "user": os.environ.get("DB_USER", "homeassistant"),
    "password": os.environ.get("DB_PASSWORD", ""),
    "database": DB_NAME,
    "charset": "utf8mb4",
    "cursorclass": pymysql.cursors.DictCursor,
}

# Same config but without 'database' - used to CREATE the DB on first run
DB_CONFIG_NO_DB = {k: v for k, v in DB_CONFIG.items() if k != "database"}


def get_db():
    return pymysql.connect(**DB_CONFIG)


def init_db():
    """Create the database if needed, then create tables."""
    for attempt in range(10):
        try:
            # Step 1: connect without selecting a DB so we can CREATE it
            conn = pymysql.connect(**DB_CONFIG_NO_DB)
            with conn.cursor() as cur:
                cur.execute(
                    f"CREATE DATABASE IF NOT EXISTS `{DB_NAME}` "
                    "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
                )
            conn.commit()
            conn.close()

            # Step 2: connect to the DB and create tables
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
                    CREATE TABLE IF NOT EXISTS boxes (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        box_number INT NOT NULL UNIQUE,
                        label VARCHAR(255),
                        room_id INT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS items (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        name VARCHAR(255) NOT NULL,
                        category VARCHAR(255),
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
            conn.commit()
            conn.close()
            logger.info("Database initialized successfully.")
            return
        except Exception as e:
            logger.warning(f"DB connection attempt {attempt+1}/10 failed: {e}")
            time.sleep(3)
    logger.error("Could not connect to database after 10 attempts. Exiting.")
    sys.exit(1)


def next_box_number():
    """Auto-increment box number using the seq table."""
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO box_number_seq (dummy) VALUES (0)")
            conn.commit()
            return cur.lastrowid
    finally:
        conn.close()


# Rooms

@app.route("/api/rooms", methods=["GET"])
def get_rooms():
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT r.*, COUNT(b.id) as box_count
                FROM rooms r
                LEFT JOIN boxes b ON b.room_id = r.id
                GROUP BY r.id
                ORDER BY r.name
            """)
            return jsonify(cur.fetchall())
    finally:
        conn.close()


@app.route("/api/rooms", methods=["POST"])
def create_room():
    data = request.json
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Room name is required"}), 400
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO rooms (name) VALUES (%s)", (name,))
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
            cur.execute("DELETE FROM rooms WHERE id=%s", (room_id,))
            conn.commit()
            return jsonify({"ok": True})
    finally:
        conn.close()


# Boxes

@app.route("/api/boxes", methods=["GET"])
def get_boxes():
    room_id = request.args.get("room_id")
    conn = get_db()
    try:
        with conn.cursor() as cur:
            sql = """
                SELECT b.*, r.name as room_name,
                       COUNT(bi.id) as item_count,
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
            return jsonify(cur.fetchall())
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
                       i.id as item_id, i.name, i.category
                FROM box_items bi
                JOIN items i ON i.id = bi.item_id
                WHERE bi.box_id = %s
                ORDER BY i.category, i.name
            """, (box_id,))
            box["items"] = cur.fetchall()
            return jsonify(box)
    finally:
        conn.close()


@app.route("/api/boxes", methods=["POST"])
def create_box():
    data = request.json
    label = (data.get("label") or "").strip() or None
    room_id = data.get("room_id") or None
    box_number = next_box_number()
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO boxes (box_number, label, room_id) VALUES (%s, %s, %s)",
                (box_number, label, room_id)
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
    room_id = data.get("room_id") or None
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE boxes SET label=%s, room_id=%s WHERE id=%s",
                (label, room_id, box_id)
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
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM boxes WHERE id=%s", (box_id,))
            conn.commit()
            return jsonify({"ok": True})
    finally:
        conn.close()


# Items

@app.route("/api/items", methods=["GET"])
def get_items():
    q = request.args.get("q", "").strip()
    conn = get_db()
    try:
        with conn.cursor() as cur:
            if q:
                cur.execute("""
                    SELECT i.*, GROUP_CONCAT(b.box_number ORDER BY b.box_number) as in_boxes
                    FROM items i
                    LEFT JOIN box_items bi ON bi.item_id = i.id
                    LEFT JOIN boxes b ON b.id = bi.box_id
                    WHERE i.name LIKE %s OR i.category LIKE %s
                    GROUP BY i.id
                    ORDER BY i.category, i.name
                """, (f"%{q}%", f"%{q}%"))
            else:
                cur.execute("""
                    SELECT i.*, GROUP_CONCAT(b.box_number ORDER BY b.box_number) as in_boxes
                    FROM items i
                    LEFT JOIN box_items bi ON bi.item_id = i.id
                    LEFT JOIN boxes b ON b.id = bi.box_id
                    GROUP BY i.id
                    ORDER BY i.category, i.name
                """)
            return jsonify(cur.fetchall())
    finally:
        conn.close()


@app.route("/api/items/categories", methods=["GET"])
def get_categories():
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT DISTINCT category FROM items WHERE category IS NOT NULL ORDER BY category")
            rows = cur.fetchall()
            return jsonify([r["category"] for r in rows if r["category"]])
    finally:
        conn.close()


@app.route("/api/items", methods=["POST"])
def create_item():
    data = request.json
    name = (data.get("name") or "").strip()
    category = (data.get("category") or "").strip() or None
    if not name:
        return jsonify({"error": "Item name is required"}), 400
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO items (name, category) VALUES (%s, %s)", (name, category))
            conn.commit()
            cur.execute("SELECT * FROM items WHERE id=%s", (cur.lastrowid,))
            return jsonify(cur.fetchone()), 201
    finally:
        conn.close()


@app.route("/api/items/<int:item_id>", methods=["PUT"])
def update_item(item_id):
    data = request.json
    name = (data.get("name") or "").strip()
    category = (data.get("category") or "").strip() or None
    if not name:
        return jsonify({"error": "Item name is required"}), 400
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("UPDATE items SET name=%s, category=%s WHERE id=%s", (name, category, item_id))
            conn.commit()
            cur.execute("SELECT * FROM items WHERE id=%s", (item_id,))
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
            cur.execute("DELETE FROM items WHERE id=%s", (item_id,))
            conn.commit()
            return jsonify({"ok": True})
    finally:
        conn.close()


# Box Items

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
            cur.execute(
                "INSERT INTO box_items (box_id, item_id, quantity, notes) VALUES (%s,%s,%s,%s)",
                (box_id, item_id, quantity, notes)
            )
            conn.commit()
            return jsonify({"ok": True, "id": cur.lastrowid}), 201
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


# Search

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
                       i.name as item_name, i.category,
                       bi.quantity, bi.notes
                FROM boxes b
                LEFT JOIN rooms r ON r.id = b.room_id
                LEFT JOIN box_items bi ON bi.box_id = b.id
                LEFT JOIN items i ON i.id = bi.item_id
                WHERE i.name LIKE %s OR i.category LIKE %s OR b.label LIKE %s
                ORDER BY b.box_number
            """, (f"%{q}%", f"%{q}%", f"%{q}%"))
            return jsonify(cur.fetchall())
    finally:
        conn.close()


# Frontend

@app.route("/")
def index():
    return render_template("index.html")


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000, debug=False)
