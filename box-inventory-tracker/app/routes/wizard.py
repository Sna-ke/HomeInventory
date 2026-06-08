"""Wizard session API — guided packing assistant."""
import json
import logging
from flask import Blueprint, jsonify, request, current_app
from db import get_db

logger = logging.getLogger(__name__)
bp = Blueprint("wizard", __name__)

def _load_wizard_data():
    import os
    path = os.path.join(current_app.static_folder, 'wizard_data.json')
    with open(path, 'r') as f:
        return json.load(f)

# ── Session CRUD ──────────────────────────────────────────────────────────────

@bp.route("/api/wizard/session", methods=["GET"])
def get_session():
    """Get the active wizard session, if any."""
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, context, phase, state, created_at, updated_at
                FROM wizard_sessions ORDER BY updated_at DESC LIMIT 1
            """)
            row = cur.fetchone()
            if not row:
                return jsonify(None)
            if row.get('state') and isinstance(row['state'], str):
                row['state'] = json.loads(row['state'])
            if row.get('created_at'): row['created_at'] = str(row['created_at'])
            if row.get('updated_at'): row['updated_at'] = str(row['updated_at'])
            return jsonify(row)
    finally:
        conn.close()


@bp.route("/api/wizard/session", methods=["POST"])
def create_session():
    """Start a new wizard session."""
    data = request.json or {}
    context = data.get('context', 'move')
    phase   = data.get('phase', 'packing')
    state   = data.get('state', {})
    conn = get_db()
    try:
        with conn.cursor() as cur:
            # Only one active session at a time
            cur.execute("DELETE FROM wizard_sessions")
            cur.execute(
                "INSERT INTO wizard_sessions (context, phase, state) VALUES (%s, %s, %s)",
                (context, phase, json.dumps(state))
            )
            conn.commit()
            cur.execute("SELECT * FROM wizard_sessions WHERE id=%s", (cur.lastrowid,))
            row = cur.fetchone()
            if row.get('state') and isinstance(row['state'], str):
                row['state'] = json.loads(row['state'])
            if row.get('created_at'): row['created_at'] = str(row['created_at'])
            if row.get('updated_at'): row['updated_at'] = str(row['updated_at'])
            return jsonify(row), 201
    finally:
        conn.close()


@bp.route("/api/wizard/session", methods=["PUT"])
def update_session():
    """Update wizard session state."""
    data = request.json or {}
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM wizard_sessions ORDER BY updated_at DESC LIMIT 1")
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "No active session"}), 404
            sid = row['id']
            updates = []
            params = []
            if 'phase' in data:
                updates.append("phase=%s"); params.append(data['phase'])
            if 'state' in data:
                updates.append("state=%s"); params.append(json.dumps(data['state']))
            if not updates:
                return jsonify({"error": "Nothing to update"}), 400
            params.append(sid)
            cur.execute(f"UPDATE wizard_sessions SET {', '.join(updates)} WHERE id=%s", params)
            conn.commit()
            cur.execute("SELECT * FROM wizard_sessions WHERE id=%s", (sid,))
            row = cur.fetchone()
            if row.get('state') and isinstance(row['state'], str):
                row['state'] = json.loads(row['state'])
            if row.get('created_at'): row['created_at'] = str(row['created_at'])
            if row.get('updated_at'): row['updated_at'] = str(row['updated_at'])
            return jsonify(row)
    finally:
        conn.close()


@bp.route("/api/wizard/session", methods=["DELETE"])
def end_session():
    """End the wizard session."""
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM wizard_sessions")
            conn.commit()
            return jsonify({"ok": True})
    finally:
        conn.close()


# ── Wizard data ───────────────────────────────────────────────────────────────

@bp.route("/api/wizard/data", methods=["GET"])
def get_wizard_data():
    """Return the full wizard suggestion data."""
    try:
        return jsonify(_load_wizard_data())
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@bp.route("/api/wizard/data", methods=["POST"])
def import_wizard_data():
    """Replace wizard_data.json with uploaded content."""
    import os
    data = request.json
    if not data or 'contexts' not in data:
        return jsonify({"error": "Invalid wizard data — must have 'contexts' key"}), 400
    path = os.path.join(current_app.static_folder, 'wizard_data.json')
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)
    return jsonify({"ok": True, "version": data.get('_version', 1)})
