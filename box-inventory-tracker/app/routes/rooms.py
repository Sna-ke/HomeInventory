"""Rooms routes."""
import logging
from flask import Blueprint, request, jsonify

from db import get_db, images_for, image_url, get_or_create_category, next_box_number
from sse import sse_push

logger = logging.getLogger(__name__)
import json as _json_mod
import requests as http_requests
import pymysql
from config import HA_TOKEN, HA_API_URL
from db import sync_ha_areas

bp = Blueprint("rooms", __name__)

# ── Rooms ──────────────────────────────────────────────────────────────────

@bp.route("/api/rooms", methods=["GET"])
def get_rooms():
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT r.id, r.name, r.ha_area_id, r.ha_synced,
                       COUNT(b.id) as box_count
                FROM rooms r
                LEFT JOIN boxes b ON b.room_id = r.id
                GROUP BY r.id
                ORDER BY r.name
            """)
            return jsonify(cur.fetchall())
    finally:
        conn.close()


@bp.route("/api/rooms/<int:room_id>/boxes", methods=["GET"])
def get_room_boxes(room_id):
    """Boxes in a room with item counts — for expand row on rooms page."""
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT b.id, b.box_number, b.label, b.description,
                       COUNT(bi.id) as item_count,
                       COALESCE(SUM(bi.quantity), 0) as total_qty,
                       (SELECT img.id
                        FROM images img WHERE img.entity_type='box' AND img.entity_id=b.id
                        ORDER BY img.created_at LIMIT 1) as thumb_id
                FROM boxes b
                LEFT JOIN box_items bi ON bi.box_id = b.id
                WHERE b.room_id = %s
                GROUP BY b.id
                ORDER BY b.box_number
            """, (room_id,))
            rows = cur.fetchall()
            for row in rows:
                tid = row.pop("thumb_id", None)
                row["thumb_url"] = image_url(tid) if tid else None
            return jsonify(rows)
    finally:
        conn.close()


@bp.route("/api/rooms/sync-ha", methods=["POST"])
def trigger_ha_sync():
    """Manually trigger HA area sync from the UI."""
    count = sync_ha_areas()
    return jsonify({"ok": True, "synced": count})


@bp.route("/api/rooms", methods=["POST"])
def create_room():
    data = request.json
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Room name is required"}), 400
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO rooms (name, ha_synced) VALUES (%s, 0)", (name,))
            conn.commit()
            sse_push("rooms")
            cur.execute("SELECT * FROM rooms WHERE id = %s", (cur.lastrowid,))
            return jsonify(cur.fetchone()), 201
    except pymysql.err.IntegrityError:
        return jsonify({"error": "A room with that name already exists"}), 409
    finally:
        conn.close()


@bp.route("/api/rooms/<int:room_id>", methods=["PUT"])
def update_room(room_id):
    data = request.json
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Room name is required"}), 400
    conn = get_db()
    try:
        with conn.cursor() as cur:
            # Don't allow renaming HA-synced areas from the app
            cur.execute("SELECT ha_synced, ha_area_id FROM rooms WHERE id=%s", (room_id,))
            row = cur.fetchone()
            if row and row["ha_synced"] and row["ha_area_id"]:
                return jsonify({"error": "This area is managed by Home Assistant. Rename it in HA."}), 403
            cur.execute("UPDATE rooms SET name=%s WHERE id=%s", (name, room_id))
            conn.commit()
            sse_push("rooms")
            cur.execute("SELECT * FROM rooms WHERE id=%s", (room_id,))
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Not found"}), 404
            return jsonify(row)
    finally:
        conn.close()


@bp.route("/api/rooms/<int:room_id>", methods=["DELETE"])
def delete_room(room_id):
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT ha_synced, ha_area_id FROM rooms WHERE id=%s", (room_id,))
            row = cur.fetchone()
            if row and row["ha_synced"] and row["ha_area_id"]:
                return jsonify({"error": "This area is managed by Home Assistant. Remove it in HA."}), 403
            cur.execute("DELETE FROM rooms WHERE id=%s", (room_id,))
            conn.commit()
            sse_push("rooms")
            return jsonify({"ok": True})
    finally:
        conn.close()
