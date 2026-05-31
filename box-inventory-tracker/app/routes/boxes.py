"""Boxes routes."""
import logging
from flask import Blueprint, request, jsonify

from db import get_db, images_for, image_url, get_or_create_category, next_box_number
from sse import sse_push

logger = logging.getLogger(__name__)

bp = Blueprint("boxes", __name__)

# ── Boxes ──────────────────────────────────────────────────────────────────

@bp.route("/api/boxes", methods=["GET"])
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


@bp.route("/api/boxes/<int:box_id>", methods=["GET"])
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


@bp.route("/api/boxes", methods=["POST"])
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
            sse_push("boxes")
            box_id = cur.lastrowid
            cur.execute("""
                SELECT b.*, r.name as room_name
                FROM boxes b LEFT JOIN rooms r ON r.id=b.room_id
                WHERE b.id=%s
            """, (box_id,))
            return jsonify(cur.fetchone()), 201
    finally:
        conn.close()


@bp.route("/api/boxes/<int:box_id>", methods=["PUT"])
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
            sse_push("boxes", {"box_id": box_id})
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


@bp.route("/api/boxes/<int:box_id>", methods=["DELETE"])
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
            sse_push("boxes")
            return jsonify({"ok": True})
    finally:
        conn.close()

# ── Box Items ──────────────────────────────────────────────────────────────

@bp.route("/api/boxes/<int:box_id>/items", methods=["POST"])
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
                sse_push("boxes", {"box_id": box_id})
                sse_push("boxes", {"box_id": box_id})
                return jsonify({"ok": True, "id": existing["id"], "incremented": True, "quantity": new_qty}), 200
            else:
                cur.execute(
                    "INSERT INTO box_items (box_id, item_id, quantity, notes) VALUES (%s,%s,%s,%s)",
                    (box_id, item_id, quantity, notes)
                )
                conn.commit()
                sse_push("boxes", {"box_id": box_id})
                return jsonify({"ok": True, "id": cur.lastrowid, "incremented": False}), 201
    finally:
        conn.close()


@bp.route("/api/box-items/<int:box_item_id>", methods=["PUT"])
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
            sse_push("boxes")
            return jsonify({"ok": True})
    finally:
        conn.close()


@bp.route("/api/box-items/<int:box_item_id>/move", methods=["POST"])
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
            sse_push("boxes")
            sse_push("boxes")
            return jsonify({
                "ok": True,
                "merged": existing is not None,
                "qty_moved": qty_to_move,
                "qty_remaining": qty_remaining,
            })
    finally:
        conn.close()


@bp.route("/api/box-items/<int:box_item_id>", methods=["DELETE"])
def remove_box_item(box_item_id):
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM box_items WHERE id=%s", (box_item_id,))
            conn.commit()
            sse_push("boxes")
            return jsonify({"ok": True})
    finally:
        conn.close()
