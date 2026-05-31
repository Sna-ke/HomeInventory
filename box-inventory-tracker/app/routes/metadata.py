"""Item metadata, credit cards, and room placements."""
import logging
import datetime
import calendar
from flask import Blueprint, request, jsonify

from db import get_db, image_url
from sse import sse_push

logger = logging.getLogger(__name__)
bp = Blueprint("metadata", __name__)


# ── Warranty helpers ──────────────────────────────────────────────────────────

def add_duration(d: datetime.date, value: int, unit: str) -> datetime.date:
    """Add a duration (days/months/years) to a date."""
    if unit == 'days':
        return d + datetime.timedelta(days=value)
    elif unit == 'months':
        month = d.month - 1 + value
        year = d.year + month // 12
        month = month % 12 + 1
        day = min(d.day, calendar.monthrange(year, month)[1])
        return datetime.date(year, month, day)
    elif unit == 'years':
        try:
            return d.replace(year=d.year + value)
        except ValueError:
            # Feb 29 edge case
            return d.replace(year=d.year + value, day=28)
    return d


def to_months(value: int, unit: str) -> float:
    """Rough conversion to months for cap comparison."""
    if unit == 'days':   return value / 30.44
    if unit == 'months': return value
    if unit == 'years':  return value * 12
    return value


def compute_warranty(purchase_date, warranty_value, warranty_unit, card):
    """
    Calculate manufacturer expiry and effective (post-CC) expiry.

    card fields: extension_type ('add'|'double'), extension_value, extension_unit,
                 extension_cap_months (nullable)
    """
    if not purchase_date or not warranty_value:
        return None, None

    if isinstance(purchase_date, str):
        purchase_date = datetime.date.fromisoformat(purchase_date)

    mfr_expiry = add_duration(purchase_date, int(warranty_value), warranty_unit or 'years')

    if not card:
        return str(mfr_expiry), str(mfr_expiry)

    ext_type  = card.get("extension_type", "add")
    ext_val   = int(card.get("extension_value") or 0)
    ext_unit  = card.get("extension_unit", "months")
    cap_months = card.get("extension_cap_months")  # max total warranty months, or None

    if ext_type == 'double':
        # Double the manufacturer warranty duration (add same duration again)
        extended_expiry = add_duration(mfr_expiry, int(warranty_value), warranty_unit or 'years')
    else:
        # Add fixed extension
        extended_expiry = add_duration(mfr_expiry, ext_val, ext_unit)

    # Apply cap if specified
    if cap_months:
        cap_expiry = add_duration(purchase_date, int(cap_months), 'months')
        if extended_expiry > cap_expiry:
            extended_expiry = cap_expiry

    return str(mfr_expiry), str(extended_expiry)


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
    name           = (data.get("name") or "").strip()
    ext_type       = data.get("extension_type", "add")
    ext_val        = int(data.get("extension_value") or 12)
    ext_unit       = data.get("extension_unit", "months")
    cap_months     = data.get("extension_cap_months") or None
    notes          = (data.get("notes") or "").strip() or None
    if not name:
        return jsonify({"error": "Card name is required"}), 400
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO credit_cards "
                "(name, extension_type, extension_value, extension_unit, extension_cap_months, notes) "
                "VALUES (%s,%s,%s,%s,%s,%s)",
                (name, ext_type, ext_val, ext_unit, cap_months, notes)
            )
            conn.commit()
            cur.execute("SELECT * FROM credit_cards WHERE id=%s", (cur.lastrowid,))
            return jsonify(cur.fetchone()), 201
    finally:
        conn.close()


@bp.route("/api/credit-cards/<int:card_id>", methods=["PUT"])
def update_credit_card(card_id):
    data = request.json or {}
    name       = (data.get("name") or "").strip()
    ext_type   = data.get("extension_type", "add")
    ext_val    = int(data.get("extension_value") or 12)
    ext_unit   = data.get("extension_unit", "months")
    cap_months = data.get("extension_cap_months") or None
    notes      = (data.get("notes") or "").strip() or None
    if not name:
        return jsonify({"error": "Card name is required"}), 400
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE credit_cards SET name=%s, extension_type=%s, extension_value=%s, "
                "extension_unit=%s, extension_cap_months=%s, notes=%s WHERE id=%s",
                (name, ext_type, ext_val, ext_unit, cap_months, notes, card_id)
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

def _serialize_meta(row):
    """Stringify dates and compute effective warranty."""
    if not row:
        return None
    for f in ("purchase_date",):
        if row.get(f):
            row[f] = str(row[f])
    card = {
        "extension_type":      row.get("card_extension_type"),
        "extension_value":     row.get("card_extension_value"),
        "extension_unit":      row.get("card_extension_unit"),
        "extension_cap_months": row.get("card_cap_months"),
    } if row.get("card_name") else None

    mfr_exp, eff_exp = compute_warranty(
        row.get("purchase_date"),
        row.get("warranty_value"),
        row.get("warranty_unit"),
        card
    )
    row["manufacturer_warranty_expiry"] = mfr_exp
    row["effective_warranty_expiry"]    = eff_exp
    return row


@bp.route("/api/items/<int:item_id>/metadata", methods=["GET"])
def get_item_metadata(item_id):
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT m.*,
                       cc.name as card_name,
                       cc.extension_type  as card_extension_type,
                       cc.extension_value as card_extension_value,
                       cc.extension_unit  as card_extension_unit,
                       cc.extension_cap_months as card_cap_months
                FROM item_metadata m
                LEFT JOIN credit_cards cc ON cc.id = m.credit_card_id
                WHERE m.item_id = %s
            """, (item_id,))
            row = cur.fetchone()
            return jsonify(_serialize_meta(row))
    finally:
        conn.close()


@bp.route("/api/items/<int:item_id>/metadata", methods=["PUT"])
def upsert_item_metadata(item_id):
    data = request.json or {}

    def opt_str(k):
        v = (data.get(k) or "").strip(); return v or None

    serial_number  = opt_str("serial_number")
    model_number   = opt_str("model_number")
    purchase_date  = opt_str("purchase_date")
    purchase_price = None
    if data.get("purchase_price") not in (None, "", "null"):
        try: purchase_price = float(str(data["purchase_price"]).replace(",", ""))
        except (ValueError, TypeError): pass
    purchase_store  = opt_str("purchase_store")
    warranty_value  = int(data["warranty_value"]) if data.get("warranty_value") else None
    warranty_unit   = data.get("warranty_unit") or "years"
    credit_card_id  = int(data["credit_card_id"]) if data.get("credit_card_id") else None
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
                        purchase_price=%s, purchase_store=%s,
                        warranty_value=%s, warranty_unit=%s,
                        credit_card_id=%s, notes=%s
                    WHERE item_id=%s
                """, (serial_number, model_number, purchase_date, purchase_price,
                      purchase_store, warranty_value, warranty_unit,
                      credit_card_id, notes, item_id))
            else:
                cur.execute("""
                    INSERT INTO item_metadata
                    (item_id, serial_number, model_number, purchase_date, purchase_price,
                     purchase_store, warranty_value, warranty_unit, credit_card_id, notes)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """, (item_id, serial_number, model_number, purchase_date, purchase_price,
                      purchase_store, warranty_value, warranty_unit, credit_card_id, notes))
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
            for item in items:
                tid = item.pop("thumb_id", None)
                item["thumb_url"] = image_url(tid) if tid else None
            return jsonify(items)
    finally:
        conn.close()


@bp.route("/api/rooms/<int:room_id>/items", methods=["POST"])
def add_room_item(room_id):
    data = request.json or {}
    item_id  = data.get("item_id")
    quantity = int(data.get("quantity") or 1)
    notes    = (data.get("notes") or "").strip() or None
    if not item_id:
        return jsonify({"error": "item_id is required"}), 400
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, quantity FROM room_items WHERE room_id=%s AND item_id=%s "
                "AND (notes=%s OR (notes IS NULL AND %s IS NULL))",
                (room_id, item_id, notes, notes)
            )
            existing = cur.fetchone()
            if existing:
                new_qty = existing["quantity"] + quantity
                cur.execute("UPDATE room_items SET quantity=%s WHERE id=%s", (new_qty, existing["id"]))
                conn.commit()
                sse_push("rooms")
                return jsonify({"ok": True, "id": existing["id"], "incremented": True, "quantity": new_qty}), 200
            else:
                cur.execute(
                    "INSERT INTO room_items (room_id, item_id, quantity, notes) VALUES (%s,%s,%s,%s)",
                    (room_id, item_id, quantity, notes)
                )
                conn.commit()
                sse_push("rooms")
                return jsonify({"ok": True, "id": cur.lastrowid, "incremented": False, "quantity": quantity}), 201
    finally:
        conn.close()


@bp.route("/api/room-items/<int:room_item_id>", methods=["PUT"])
def update_room_item(room_item_id):
    data = request.json or {}
    quantity = int(data.get("quantity") or 1)
    notes    = (data.get("notes") or "").strip() or None
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("UPDATE room_items SET quantity=%s, notes=%s WHERE id=%s",
                        (quantity, notes, room_item_id))
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
