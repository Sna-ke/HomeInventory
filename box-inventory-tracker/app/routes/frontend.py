"""Frontend routes."""
import logging
from flask import Blueprint, request, jsonify

from db import get_db, images_for, image_url, get_or_create_category, next_box_number
from sse import sse_push

logger = logging.getLogger(__name__)
from flask import render_template

bp = Blueprint("frontend", __name__)

# ── Frontend ───────────────────────────────────────────────────────────────

@bp.route("/")
def index():
    # HA ingress injects X-Ingress-Path (e.g. /api/hassio_ingress/abc123)
    # We pass it to the template so the frontend can prefix all API calls.
    ingress_path = request.headers.get("X-Ingress-Path", "").rstrip("/")
    return render_template("index.html", ingress_path=ingress_path)


if __name__ == "__main__":
    init_db()
    migrate_db()
    sync_ha_areas()
    app.run(host="0.0.0.0", port=5000, debug=False)
