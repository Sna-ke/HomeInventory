"""Data import routes — JSON import of items and categories."""
import logging
from flask import Blueprint, request, jsonify

from db import get_db, get_or_create_category
from sse import sse_push

logger = logging.getLogger(__name__)
bp = Blueprint("import_data", __name__)


@bp.route("/api/import/preview", methods=["POST"])
def import_preview():
    """Parse the uploaded JSON and return a summary without writing anything."""
    data = request.json
    if not data:
        return jsonify({"error": "No JSON body"}), 400

    categories = data.get("categories", [])
    rooms_list = data.get("rooms", [])
    items = data.get("items", [])
    boxes = data.get("boxes", [])

    if not isinstance(categories, list) or not isinstance(items, list):
        return jsonify({"error": "JSON must have 'categories' (array) and 'items' (array)"}), 400

    valid_cats = set(categories)
    errors = []
    for i, item in enumerate(items):
        if not isinstance(item, dict):
            errors.append(f"Item {i}: not an object"); continue
        if not item.get("name"):
            errors.append(f"Item {i}: missing 'name'")

    total_contents = sum(len(b.get("contents", [])) for b in boxes if isinstance(b, dict))

    return jsonify({
        "categories": len(categories),
        "rooms": len(rooms_list),
        "items": len(items),
        "boxes": len(boxes),
        "box_contents": total_contents,
        "errors": errors[:20],
        "error_count": len(errors),
        "valid": len(errors) == 0,
    })


@bp.route("/api/import/run", methods=["POST"])
def import_run():
    """Import categories, rooms, items, and boxes from JSON. Skips duplicates by name."""
    data = request.json
    if not data:
        return jsonify({"error": "No JSON body"}), 400

    categories = data.get("categories", [])
    rooms_list = data.get("rooms", [])
    items = data.get("items", [])
    boxes = data.get("boxes", [])
    skip_existing = data.get("skip_existing", True)

    conn = get_db()
    stats = {
        "categories_added": 0, "rooms_added": 0,
        "items_added": 0, "items_skipped": 0,
        "boxes_added": 0, "box_items_added": 0,
        "errors": [],
    }
    try:
        with conn.cursor() as cur:
            # ── Categories ────────────────────────────────────────────────────
            for cat_name in categories:
                cat_name = (cat_name or "").strip()
                if not cat_name:
                    continue
                cur.execute("SELECT id FROM categories WHERE name=%s", (cat_name,))
                if not cur.fetchone():
                    cur.execute("INSERT INTO categories (name) VALUES (%s)", (cat_name,))
                    stats["categories_added"] += 1
            conn.commit()

            # ── Rooms ─────────────────────────────────────────────────────────
            for room_name in rooms_list:
                room_name = (room_name or "").strip()
                if not room_name:
                    continue
                cur.execute("SELECT id FROM rooms WHERE name=%s", (room_name,))
                if not cur.fetchone():
                    cur.execute("INSERT INTO rooms (name) VALUES (%s)", (room_name,))
                    stats["rooms_added"] += 1
            conn.commit()

            # ── Items ─────────────────────────────────────────────────────────
            # Build name→id cache for items that already exist
            cur.execute("SELECT id, name FROM items")
            existing_items = {r["name"].lower(): r["id"] for r in cur.fetchall()}

            def get_or_create_item(name, category, upc):
                name = (name or "").strip()
                if not name:
                    return None
                lower = name.lower()
                if skip_existing and lower in existing_items:
                    stats["items_skipped"] += 1
                    return existing_items[lower]
                cat_name = (category or "").strip()
                cat_id = None
                if cat_name:
                    cur.execute("SELECT id FROM categories WHERE name=%s", (cat_name,))
                    row = cur.fetchone()
                    cat_id = row["id"] if row else None
                upc_val = (upc or "").strip() or None
                cur.execute(
                    "INSERT INTO items (name, category_id, upc) VALUES (%s,%s,%s)",
                    (name, cat_id, upc_val)
                )
                new_id = cur.lastrowid
                existing_items[lower] = new_id
                stats["items_added"] += 1
                return new_id

            for item in items:
                get_or_create_item(
                    item.get("name"), item.get("category"), item.get("upc")
                )
            conn.commit()

            # ── Boxes + contents ──────────────────────────────────────────────
            for box in boxes:
                label = (box.get("label") or "").strip()
                description = (box.get("description") or "").strip() or None
                room_name = (box.get("room") or "").strip()

                # Resolve room
                room_id = None
                if room_name:
                    cur.execute("SELECT id FROM rooms WHERE name=%s", (room_name,))
                    row = cur.fetchone()
                    room_id = row["id"] if row else None

                # Allocate a new box number (always fresh — don't try to reuse old numbers)
                cur.execute(
                    "INSERT INTO box_number_seq (dummy) VALUES (0)"
                )
                box_number = cur.lastrowid

                cur.execute(
                    "INSERT INTO boxes (box_number, label, description, room_id) "
                    "VALUES (%s,%s,%s,%s)",
                    (box_number, label or None, description, room_id)
                )
                box_id = cur.lastrowid
                stats["boxes_added"] += 1

                # Contents
                for entry in (box.get("contents") or []):
                    item_id = get_or_create_item(
                        entry.get("item"), entry.get("category"), entry.get("upc")
                    )
                    if not item_id:
                        continue
                    qty = max(1, int(entry.get("quantity") or 1))
                    notes = (entry.get("notes") or "").strip() or None
                    cur.execute(
                        "INSERT INTO box_items (box_id, item_id, quantity, notes) "
                        "VALUES (%s,%s,%s,%s)",
                        (box_id, item_id, qty, notes)
                    )
                    stats["box_items_added"] += 1

            conn.commit()

    except Exception as e:
        logger.error(f"Import error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

    sse_push("items")
    sse_push("categories")
    sse_push("rooms")
    sse_push("boxes")
    logger.info(f"Import complete: {stats}")
    return jsonify(stats)
