"""Dashboard summary endpoint."""
import logging
from flask import Blueprint, jsonify
from db import get_db

logger = logging.getLogger(__name__)
bp = Blueprint("dashboard", __name__)


@bp.route("/api/dashboard", methods=["GET"])
def get_dashboard():
    conn = get_db()
    try:
        with conn.cursor() as cur:

            # ── Totals ────────────────────────────────────────────────────────
            cur.execute("SELECT COUNT(*) as n FROM boxes")
            total_boxes = cur.fetchone()["n"]

            cur.execute("SELECT COUNT(*) as n FROM rooms")
            total_rooms = cur.fetchone()["n"]

            cur.execute("SELECT COUNT(*) as n FROM items")
            total_item_types = cur.fetchone()["n"]

            cur.execute("SELECT COALESCE(SUM(quantity),0) as n FROM box_items")
            total_items_packed = int(cur.fetchone()["n"])

            cur.execute("SELECT COALESCE(SUM(quantity),0) as n FROM room_items")
            total_items_placed = int(cur.fetchone()["n"])

            cur.execute("""
                SELECT COUNT(DISTINCT bi.item_id) as n FROM box_items bi
            """)
            distinct_types_packed = cur.fetchone()["n"]

            # ── Boxes per room ────────────────────────────────────────────────
            cur.execute("""
                SELECT r.id, r.name,
                       COUNT(DISTINCT b.id) as box_count,
                       COALESCE(SUM(bi.quantity),0) as item_count,
                       COUNT(DISTINCT ri.id) as placed_count
                FROM rooms r
                LEFT JOIN boxes b ON b.room_id = r.id
                LEFT JOIN box_items bi ON bi.box_id = b.id
                LEFT JOIN room_items ri ON ri.room_id = r.id
                GROUP BY r.id
                ORDER BY r.name
            """)
            rooms = cur.fetchall()
            for r in rooms:
                r["item_count"] = int(r["item_count"])
                r["placed_count"] = int(r["placed_count"])

            # ── Category breakdown ────────────────────────────────────────────
            cur.execute("""
                SELECT c.name as category,
                       COUNT(DISTINCT i.id)       as total_types,
                       COUNT(DISTINCT bi.item_id) as packed_types,
                       COALESCE(SUM(bi.quantity), 0) as packed_qty
                FROM categories c
                LEFT JOIN items i ON i.category_id = c.id
                LEFT JOIN box_items bi ON bi.item_id = i.id
                GROUP BY c.id
                ORDER BY packed_qty DESC, c.name
            """)
            categories = cur.fetchall()
            for cat in categories:
                cat["packed_qty"] = int(cat["packed_qty"])

            # ── Boxes without a room ──────────────────────────────────────────
            cur.execute("""
                SELECT COUNT(*) as n FROM boxes WHERE room_id IS NULL
            """)
            unassigned_boxes = cur.fetchone()["n"]

            # ── Recent activity (last 20 box_items by rowid) ──────────────────
            cur.execute("""
                SELECT bi.id, bi.quantity, bi.notes,
                       i.name as item_name, c.name as category,
                       b.box_number, b.label as box_label,
                       r.name as room_name
                FROM box_items bi
                JOIN items i ON i.id = bi.item_id
                LEFT JOIN categories c ON c.id = i.category_id
                JOIN boxes b ON b.id = bi.box_id
                LEFT JOIN rooms r ON r.id = b.room_id
                ORDER BY bi.id DESC
                LIMIT 20
            """)
            recent = cur.fetchall()

            # ── Empty boxes ───────────────────────────────────────────────────
            cur.execute("""
                SELECT COUNT(*) as n FROM boxes b
                WHERE NOT EXISTS (SELECT 1 FROM box_items bi WHERE bi.box_id = b.id)
            """)
            empty_boxes = cur.fetchone()["n"]

            # ── Top categories in boxes ───────────────────────────────────────
            cur.execute("""
                SELECT c.name, COALESCE(SUM(bi.quantity),0) as qty
                FROM box_items bi
                JOIN items i ON i.id = bi.item_id
                LEFT JOIN categories c ON c.id = i.category_id
                GROUP BY c.id
                ORDER BY qty DESC
                LIMIT 8
            """)
            top_cats = cur.fetchall()
            for t in top_cats:
                t["qty"] = int(t["qty"])

            return jsonify({
                "totals": {
                    "boxes":              total_boxes,
                    "rooms":              total_rooms,
                    "item_types":         total_item_types,
                    "items_packed":       total_items_packed,
                    "items_placed":       total_items_placed,
                    "distinct_types_packed": distinct_types_packed,
                    "unassigned_boxes":   unassigned_boxes,
                    "empty_boxes":        empty_boxes,
                },
                "rooms":       rooms,
                "categories":  categories,
                "top_cats":    top_cats,
                "recent":      recent,
            })
    finally:
        conn.close()
