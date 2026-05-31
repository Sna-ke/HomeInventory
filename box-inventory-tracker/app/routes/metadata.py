"""Item metadata, credit cards, and room placements."""
import logging
from flask import Blueprint, request, jsonify

from db import get_db
from sse import sse_push

logger = logging.getLogger(__name__)
bp = Blueprint("metadata", __name__)


# ── Credit Cards ──────────────────────────────────────────────────────────────

@bp.route("/api/credit-cards", methods=["GET"])
def get_credit_cards():
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM credit_cards ORDER BY name")
            return jsonify(cur.fetchall())
    finally:
        conn.close()


@bp.route("/api/credit-cards", methods=["POST"])
def create_credit_card():
    data = request.json or {}
    name = (data.get("name") or "").strip()
    warranty_months = int(data.get("warranty_months") or 12)
    notes = (data.get("notes") or "").strip() or None
    if not name:
        return jsonify({"error": "Card name is required"}), 400
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO credit_cards (name, warranty_months, notes) VALUES (%s,%s,%s)",
                (name, warranty_months, notes)
            )
            conn.commit()
            cur.execute("SELECT * FROM credit_cards WHERE id=%s", (cur.lastrowid,))
            return jsonify(cur.fetchone()), 201
    finally:
        conn.close()


@bp.route("/api/credit-cards/<int:card_id>", methods=["PUT"])
def update_credit_card(card_id):
    data = request.json or {}
    name = (data.get("name") or "").strip()
    warranty_months = int(data.get("warranty_months") or 12)
    notes = (data.get("notes") or "").strip() or None
    if not name:
        return jsonify({"error": "Card name is required"}), 400
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE credit_cards SET name=%s, warranty_months=%s, notes=%s WHERE id=%s",
                (name, warranty_months, notes, card_id)
            )
            conn.commit()
            cur.execute("SELECT * FROM credit_cards WHERE id=%s", (card_id,))
            return jsonify(cur.fetchone())
    finally:
        conn.close()


@bp.route("/api/credit-cards/<int:card_id>", methods=["DELETE"])
def delete_credit_card(card_id):
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM credit_cards WHERE id=%s", (card_id,))
            conn.commit()
            return jsonify({"ok": True})
    finally:
        conn.close()


# ── Item Metadata ─────────────────────────────────────────────────────────────

def _effective_warranty(warranty_expiry, card_months):
    """Return effective warranty end date given base expiry and CC extension months."""
    if not warranty_expiry:
        return None
    if not card_months:
        return str(warranty_expiry)
    import datetime
    if isinstance(warranty_expiry, str):
        try:
            d = datetime.date.fromisoformat(warranty_expiry)
        except ValueError:
            return str(warranty_expiry)
    else:
        d = warranty_expiry
    # Add months
    month = d.month - 1 + card_months
    year = d.year + month // 12
    month = month % 12 + 1
    import calendar
    day = min(d.day, calendar.monthrange(year, month)[1])
    return str(datetime.date(year, month, day))


@bp.route("/api/items/<int:item_id>/metadata", methods=["GET"])
def get_item_metadata(item_id):
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT m.*, cc.name as card_name, cc.warranty_months as card_warranty_months
                FROM item_metadata m
                LEFT JOIN credit_cards cc ON cc.id = m.credit_card_id
                WHERE m.item_id = %s
            """, (item_id,))
            row = cur.fetchone()
            if not row:
                return jsonify(None)
            # Compute effective warranty end
            row["effective_warranty_expiry"] = _effective_warranty(
                row.get("warranty_expiry"), row.get("card_warranty_months")
            )
            # Stringify dates for JSON
            for f in ("purchase_date", "warranty_expiry"):
                if row.get(f):
                    row[f] = str(row[f])
            return jsonify(row)
    finally:
        conn.close()


@bp.route("/api/items/<int:item_id>/metadata", methods=["PUT"])
def upsert_item_metadata(item_id):
    data = request.json or {}

    def opt_str(k):
        v = (data.get(k) or "").strip()
        return v or None

    def opt_date(k):
        v = (data.get(k) or "").strip()
        return v if v else None

    def opt_decimal(k):
        v = data.get(k)
        if v in (None, "", "null"):
            return None
        try:
            return float(str(v).replace(",", ""))
        except (ValueError, TypeError):
            return None

    serial_number   = opt_str("serial_number")
    model_number    = opt_str("model_number")
    purchase_date   = opt_date("purchase_date")
    purchase_price  = opt_decimal("purchase_price")
    purchase_store  = opt_str("purchase_store")
    warranty_expiry = opt_date("warranty_expiry")
    credit_card_id  = data.get("credit_card_id") or None
    notes           = opt_str("notes")

    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM item_metadata WHERE item_id=%s", (item_id,))
            existing = cur.fetchone()
            if existing:
                cur.execute("""
                    UPDATE item_metadata
                    SET serial_number=%s, model_number=%s, purchase_date=%s,
                        purchase_price=%s, purchase_store=%s, warranty_expiry=%s,
                        credit_card_id=%s, notes=%s
                    WHERE item_id=%s
                """, (serial_number, model_number, purchase_date, purchase_price,
                      purchase_store, warranty_expiry, credit_card_id, notes, item_id))
            else:
                cur.execute("""
                    INSERT INTO item_metadata
                    (item_id, serial_number, model_number, purchase_date,
                     purchase_price, purchase_store, warranty_expiry, credit_card_id, notes)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """, (item_id, serial_number, model_number, purchase_date,
                      purchase_price, purchase_store, warranty_expiry, credit_card_id, notes))
            conn.commit()
        return get_item_metadata(item_id)
    finally:
        conn.close()


# ── Room Placements ───────────────────────────────────────────────────────────

@bp.route("/api/rooms/<int:room_id>/items", methods=["GET"])
def get_room_items(room_id):
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT ri.id as room_item_id, ri.quantity, ri.notes,
                       i.id as item_id, i.name, i.upc,
                       c.id as category_id, c.name as category,
                       (SELECT img.id FROM images img
                        WHERE img.entity_type='item' AND img.entity_id=i.id
                        ORDER BY img.created_at LIMIT 1) as thumb_id
                FROM room_items ri
                JOIN items i ON i.id = ri.item_id
                LEFT JOIN categories c ON c.id = i.category_id
                WHERE ri.room_id = %s
                ORDER BY c.name, i.name
            """, (room_id,))
            items = cur.fetchall()
            from db import image_url
            for item in items:
                tid = item.pop("thumb_id", None)
                item["thumb_url"] = image_url(tid) if tid else None
            return jsonify(items)
    finally:
        conn.close()


@bp.route("/api/rooms/<int:room_id>/items", methods=["POST"])
def add_room_item(room_id):
    data = request.json or {}
    item_id = data.get("item_id")
    quantity = int(data.get("quantity") or 1)
    notes = (data.get("notes") or "").strip() or None
    if not item_id:
        return jsonify({"error": "item_id is required"}), 400

    conn = get_db()
    try:
        with conn.cursor() as cur:
            # Check if same item already placed in this room (merge)
            cur.execute(
                "SELECT id, quantity FROM room_items WHERE room_id=%s AND item_id=%s AND "
                "(notes=%s OR (notes IS NULL AND %s IS NULL))",
                (room_id, item_id, notes, notes)
            )
            existing = cur.fetchone()
            if existing:
                new_qty = existing["quantity"] + quantity
                cur.execute("UPDATE room_items SET quantity=%s WHERE id=%s",
                            (new_qty, existing["id"]))
                conn.commit()
                sse_push("rooms")
                return jsonify({"ok": True, "id": existing["id"],
                                "incremented": True, "quantity": new_qty}), 200
            else:
                cur.execute(
                    "INSERT INTO room_items (room_id, item_id, quantity, notes) VALUES (%s,%s,%s,%s)",
                    (room_id, item_id, quantity, notes)
                )
                conn.commit()
                sse_push("rooms")
                return jsonify({"ok": True, "id": cur.lastrowid,
                                "incremented": False, "quantity": quantity}), 201
    finally:
        conn.close()


@bp.route("/api/room-items/<int:room_item_id>", methods=["PUT"])
def update_room_item(room_item_id):
    data = request.json or {}
    quantity = int(data.get("quantity") or 1)
    notes = (data.get("notes") or "").strip() or None
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE room_items SET quantity=%s, notes=%s WHERE id=%s",
                (quantity, notes, room_item_id)
            )
            conn.commit()
            sse_push("rooms")
            return jsonify({"ok": True})
    finally:
        conn.close()


@bp.route("/api/room-items/<int:room_item_id>", methods=["DELETE"])
def delete_room_item(room_item_id):
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM room_items WHERE id=%s", (room_item_id,))
            conn.commit()
            sse_push("rooms")
            return jsonify({"ok": True})
    finally:
        conn.close()
