"""Images routes."""
import logging
from flask import Blueprint, request, jsonify

from db import get_db, images_for, image_url, get_or_create_category, next_box_number
from sse import sse_push

logger = logging.getLogger(__name__)
import uuid, mimetypes, io
from pathlib import Path
from flask import send_file, abort
from PIL import Image
from db import UPLOAD_DIR, ALLOWED_MIME, MAX_IMAGE_BYTES

bp = Blueprint("images", __name__)

# ── Images ─────────────────────────────────────────────────────────────────

def _delete_image_file(filename):
    try:
        (UPLOAD_DIR / filename).unlink(missing_ok=True)
    except Exception as e:
        logger.warning(f"Could not delete image file {filename}: {e}")


@bp.route("/api/images/upload", methods=["POST"])
def upload_image():
    entity_type = request.form.get("entity_type")  # 'box' or 'item'
    entity_id = request.form.get("entity_id")
    if entity_type not in ("box", "item") or not entity_id:
        return jsonify({"error": "entity_type (box|item) and entity_id are required"}), 400
    entity_id = int(entity_id)

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    f = request.files["file"]
    if not f.filename:
        return jsonify({"error": "Empty filename"}), 400

    mime = f.mimetype or mimetypes.guess_type(f.filename)[0] or ""
    if mime not in ALLOWED_MIME:
        return jsonify({"error": f"Unsupported image type: {mime}"}), 415

    data = f.read()
    if len(data) > MAX_IMAGE_BYTES:
        return jsonify({"error": "Image too large (max 20 MB)"}), 413

    ext = Path(f.filename).suffix.lower() or ".jpg"
    filename = f"{uuid.uuid4().hex}{ext}"
    (UPLOAD_DIR / filename).write_bytes(data)

    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO images (filename, original_name, mime_type, entity_type, entity_id) "
                "VALUES (%s,%s,%s,%s,%s)",
                (filename, f.filename, mime, entity_type, entity_id)
            )
            conn.commit()
            image_id = cur.lastrowid
        return jsonify({"id": image_id, "url": image_url(image_id)}), 201
    finally:
        conn.close()


@bp.route("/api/images/<int:image_id>", methods=["GET"])
def serve_image(image_id):
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT filename, mime_type FROM images WHERE id=%s", (image_id,))
            row = cur.fetchone()
    finally:
        conn.close()
    if not row:
        abort(404)
    path = UPLOAD_DIR / row["filename"]
    if not path.exists():
        abort(404)
    return send_file(path, mimetype=row["mime_type"])


@bp.route("/api/images/<int:image_id>", methods=["DELETE"])
def delete_image(image_id):
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT filename FROM images WHERE id=%s", (image_id,))
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Not found"}), 404
            _delete_image_file(row["filename"])
            cur.execute("DELETE FROM images WHERE id=%s", (image_id,))
            conn.commit()
            return jsonify({"ok": True})
    finally:
        conn.close()
