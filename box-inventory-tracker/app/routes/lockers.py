"""Storage locker manager."""
import logging
from flask import Blueprint, jsonify, request
from db import get_db

logger = logging.getLogger(__name__)
bp = Blueprint("lockers", __name__)


def _serialize(row):
    if not row: return None
    for k in ('contract_start', 'contract_end', 'created_at'):
        if row.get(k): row[k] = str(row[k])
    for k in ('size_width_ft','size_depth_ft','size_height_ft','monthly_cost','insurance_monthly'):
        if row.get(k) is not None: row[k] = float(row[k])
    return row


@bp.route("/api/lockers", methods=["GET"])
def get_lockers():
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT l.*,
                       r.name as room_name,
                       COUNT(DISTINCT b.id) as box_count,
                       COALESCE(SUM(bi.quantity),0) as item_count
                FROM storage_lockers l
                LEFT JOIN rooms r ON r.id = l.room_id
                LEFT JOIN boxes b ON b.room_id = l.room_id
                LEFT JOIN box_items bi ON bi.box_id = b.id
                GROUP BY l.id
                ORDER BY l.name
            """)
            rows = cur.fetchall()
            return jsonify([_serialize(r) for r in rows])
    finally:
        conn.close()


@bp.route("/api/lockers", methods=["POST"])
def create_locker():
    data = request.json or {}
    fields = _extract(data)
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cols = ', '.join(fields.keys())
            phs  = ', '.join(['%s'] * len(fields))
            cur.execute(f"INSERT INTO storage_lockers ({cols}) VALUES ({phs})",
                        list(fields.values()))
            conn.commit()
            cur.execute("SELECT * FROM storage_lockers WHERE id=%s", (cur.lastrowid,))
            return jsonify(_serialize(cur.fetchone())), 201
    finally:
        conn.close()


@bp.route("/api/lockers/<int:locker_id>", methods=["GET"])
def get_locker(locker_id):
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM storage_lockers WHERE id=%s", (locker_id,))
            row = cur.fetchone()
            if not row: return jsonify({"error": "Not found"}), 404
            return jsonify(_serialize(row))
    finally:
        conn.close()


@bp.route("/api/lockers/<int:locker_id>", methods=["PUT"])
def update_locker(locker_id):
    data = request.json or {}
    fields = _extract(data)
    if not fields: return jsonify({"error": "Nothing to update"}), 400
    conn = get_db()
    try:
        with conn.cursor() as cur:
            sets = ', '.join(f"{k}=%s" for k in fields)
            cur.execute(f"UPDATE storage_lockers SET {sets} WHERE id=%s",
                        list(fields.values()) + [locker_id])
            conn.commit()
            cur.execute("SELECT * FROM storage_lockers WHERE id=%s", (locker_id,))
            return jsonify(_serialize(cur.fetchone()))
    finally:
        conn.close()


@bp.route("/api/lockers/<int:locker_id>", methods=["DELETE"])
def delete_locker(locker_id):
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM storage_lockers WHERE id=%s", (locker_id,))
            conn.commit()
            return jsonify({"ok": True})
    finally:
        conn.close()


def _extract(data):
    """Extract and validate locker fields from request data."""
    def s(k): v = (data.get(k) or '').strip(); return v or None
    def f(k): 
        v = data.get(k)
        if v in (None, '', 'null'): return None
        try: return float(str(v).replace(',',''))
        except: return None
    def d(k): v = s(k); return v if v else None
    def b(k): return 1 if data.get(k) else 0

    out = {}
    if 'name' in data:          out['name']                = (data.get('name') or '').strip() or 'Untitled Locker'
    if 'provider' in data:      out['provider']            = s('provider')
    if 'address' in data:       out['address']             = s('address')
    if 'unit_number' in data:   out['unit_number']         = s('unit_number')
    if 'size_width_ft' in data: out['size_width_ft']       = f('size_width_ft')
    if 'size_depth_ft' in data: out['size_depth_ft']       = f('size_depth_ft')
    if 'size_height_ft' in data:out['size_height_ft']      = f('size_height_ft')
    if 'monthly_cost' in data:  out['monthly_cost']        = f('monthly_cost')
    if 'currency' in data:      out['currency']            = s('currency') or 'CAD'
    if 'access_hours' in data:  out['access_hours']        = s('access_hours')
    if 'gate_code' in data:     out['gate_code']           = s('gate_code')
    if 'lock_type' in data:     out['lock_type']           = s('lock_type')
    if 'climate_controlled' in data: out['climate_controlled'] = b('climate_controlled')
    if 'insurance_included' in data: out['insurance_included']  = b('insurance_included')
    if 'insurance_monthly' in data:  out['insurance_monthly']   = f('insurance_monthly')
    if 'contract_start' in data:out['contract_start']      = d('contract_start')
    if 'contract_end' in data:  out['contract_end']        = d('contract_end')
    if 'notes' in data:         out['notes']               = s('notes')
    if 'room_id' in data:
        v = data.get('room_id')
        out['room_id'] = int(v) if v else None
    return out
