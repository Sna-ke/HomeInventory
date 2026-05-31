"""Items routes."""
import logging
from flask import Blueprint, request, jsonify

from db import get_db, images_for, image_url, get_or_create_category, next_box_number
from sse import sse_push

logger = logging.getLogger(__name__)
import requests as http_requests

bp = Blueprint("items", __name__)

# ── Items ──────────────────────────────────────────────────────────────────

@bp.route("/api/items", methods=["GET"])
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


@bp.route("/api/items", methods=["POST"])
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
            sse_push("items")
            item_id = cur.lastrowid
            cur.execute("""
                SELECT i.id, i.name, i.upc, c.id as category_id, c.name as category
                FROM items i LEFT JOIN categories c ON c.id=i.category_id
                WHERE i.id=%s
            """, (item_id,))
            return jsonify(cur.fetchone()), 201
    finally:
        conn.close()


@bp.route("/api/items/<int:item_id>", methods=["PUT"])
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
            sse_push("items", {"item_id": item_id})
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


@bp.route("/api/items/<int:item_id>", methods=["DELETE"])
def delete_item(item_id):
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT filename FROM images WHERE entity_type='item' AND entity_id=%s", (item_id,))
            for row in cur.fetchall():
                _delete_image_file(row["filename"])
            cur.execute("DELETE FROM items WHERE id=%s", (item_id,))
            conn.commit()
            sse_push("items")
            return jsonify({"ok": True})
    finally:
        conn.close()


@bp.route("/api/items/<int:item_id>", methods=["GET"])
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

# ── Search ─────────────────────────────────────────────────────────────────

@bp.route("/api/search", methods=["GET"])
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
