"""Categories routes."""
import logging
from flask import Blueprint, request, jsonify

import pymysql
from db import get_db, images_for, image_url, get_or_create_category, next_box_number
from sse import sse_push

logger = logging.getLogger(__name__)

bp = Blueprint("categories", __name__)

# ── Categories ─────────────────────────────────────────────────────────────

@bp.route("/api/categories", methods=["GET"])
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


@bp.route("/api/categories", methods=["POST"])
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
            sse_push("categories")
            cur.execute("SELECT id, name FROM categories WHERE id=%s", (cur.lastrowid,))
            return jsonify(cur.fetchone()), 201
    except pymysql.err.IntegrityError:
        return jsonify({"error": "A category with that name already exists"}), 409
    finally:
        conn.close()


@bp.route("/api/categories/<int:cat_id>", methods=["PUT"])
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
            sse_push("categories")
            cur.execute("SELECT id, name FROM categories WHERE id=%s", (cat_id,))
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Not found"}), 404
            return jsonify(row)
    except pymysql.err.IntegrityError:
        return jsonify({"error": "A category with that name already exists"}), 409
    finally:
        conn.close()


@bp.route("/api/categories/<int:cat_id>", methods=["DELETE"])
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
            sse_push("categories")
            return jsonify({"ok": True})
    finally:
        conn.close()


@bp.route("/api/categories/<int:cat_id>/items", methods=["GET"])
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
