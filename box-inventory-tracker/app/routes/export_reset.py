"""Export and reset endpoints."""
import logging
from pathlib import Path
from flask import Blueprint, request, jsonify

from db import get_db, UPLOAD_DIR
from sse import sse_push

logger = logging.getLogger(__name__)
bp = Blueprint("export_reset", __name__)


@bp.route("/api/export", methods=["POST"])
def export_data():
    """Export rooms, boxes, items and categories as a restorable JSON backup.

    Body: { "box_ids": [1,2,3] }  — omit or pass null to export everything.
    """
    body = request.json or {}
    box_ids = body.get("box_ids")  # None = export all

    conn = get_db()
    try:
        with conn.cursor() as cur:
            # ── Categories ────────────────────────────────────────────────────
            cur.execute("SELECT name FROM categories ORDER BY name")
            categories = [r["name"] for r in cur.fetchall()]

            # ── Rooms (only those referenced by selected boxes, or all) ───────
            if box_ids:
                cur.execute("""
                    SELECT DISTINCT r.id, r.name
                    FROM rooms r
                    JOIN boxes b ON b.room_id = r.id
                    WHERE b.id IN ({})
                    ORDER BY r.name
                """.format(",".join(["%s"] * len(box_ids))), box_ids)
            else:
                cur.execute("SELECT id, name FROM rooms ORDER BY name")
            rooms_rows = cur.fetchall()
            rooms = [r["name"] for r in rooms_rows]
            room_id_to_name = {r["id"]: r["name"] for r in rooms_rows}

            # ── Boxes + contents ──────────────────────────────────────────────
            if box_ids:
                cur.execute("""
                    SELECT b.id, b.box_number, b.label, b.description, b.room_id
                    FROM boxes b WHERE b.id IN ({})
                    ORDER BY b.box_number
                """.format(",".join(["%s"] * len(box_ids))), box_ids)
            else:
                cur.execute("""
                    SELECT id, box_number, label, description, room_id
                    FROM boxes ORDER BY box_number
                """)
            box_rows = cur.fetchall()

            boxes = []
            all_item_ids = set()

            for box in box_rows:
                cur.execute("""
                    SELECT bi.quantity, bi.notes,
                           i.id as item_id, i.name as item_name, i.upc,
                           c.name as category
                    FROM box_items bi
                    JOIN items i ON i.id = bi.item_id
                    LEFT JOIN categories c ON c.id = i.category_id
                    WHERE bi.box_id = %s
                    ORDER BY i.name
                """, (box["id"],))
                contents = cur.fetchall()
                all_item_ids.update(r["item_id"] for r in contents)

                boxes.append({
                    "box_number": box["box_number"],
                    "label": box["label"] or "",
                    "description": box["description"] or "",
                    "room": room_id_to_name.get(box["room_id"], ""),
                    "contents": [
                        {
                            "item": r["item_name"],
                            "category": r["category"] or "",
                            "quantity": r["quantity"],
                            "notes": r["notes"] or "",
                            "upc": r["upc"] or "",
                        }
                        for r in contents
                    ],
                })

            # ── Items (all, or only those referenced by selected boxes) ────────
            if box_ids and all_item_ids:
                id_list = ",".join(["%s"] * len(all_item_ids))
                cur.execute(f"""
                    SELECT i.name, i.upc, c.name as category
                    FROM items i
                    LEFT JOIN categories c ON c.id = i.category_id
                    WHERE i.id IN ({id_list})
                    ORDER BY i.name
                """, list(all_item_ids))
            elif box_ids:
                cur.execute("SELECT '' as name, '' as upc, '' as category LIMIT 0")
            else:
                cur.execute("""
                    SELECT i.name, i.upc, c.name as category
                    FROM items i
                    LEFT JOIN categories c ON c.id = i.category_id
                    ORDER BY i.name
                """)
            items = [
                {"name": r["name"], "category": r["category"] or "", "upc": r["upc"] or ""}
                for r in cur.fetchall()
            ]

        payload = {
            "version": "1",
            "rooms": rooms,
            "categories": categories,
            "items": items,
            "boxes": boxes,
        }
        return jsonify(payload)

    finally:
        conn.close()


@bp.route("/api/reset", methods=["POST"])
def reset_all():
    """Delete all data. Requires confirmation phrase in body."""
    body = request.json or {}
    phrase = body.get("phrase", "").strip()
    if phrase != "I want to delete all data":
        return jsonify({"error": "Incorrect confirmation phrase"}), 400

    conn = get_db()
    try:
        with conn.cursor() as cur:
            # Delete image files from disk first
            cur.execute("SELECT filename FROM images")
            for row in cur.fetchall():
                try:
                    Path(UPLOAD_DIR / row["filename"]).unlink(missing_ok=True)
                except Exception:
                    pass

            # Disable FK checks for clean truncation
            cur.execute("SET FOREIGN_KEY_CHECKS = 0")
            for table in ["box_items", "images", "boxes", "box_number_seq", "items", "categories", "rooms"]:
                cur.execute(f"TRUNCATE TABLE {table}")
            cur.execute("SET FOREIGN_KEY_CHECKS = 1")
            conn.commit()

        logger.info("Full data reset performed")
        sse_push("boxes")
        sse_push("rooms")
        sse_push("items")
        sse_push("categories")
        return jsonify({"ok": True})

    except Exception as e:
        logger.error(f"Reset error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()
