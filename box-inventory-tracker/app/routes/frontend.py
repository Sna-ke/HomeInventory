"""Frontend routes."""
import logging
from flask import Blueprint, request, render_template

logger = logging.getLogger(__name__)

bp = Blueprint("frontend", __name__)


@bp.route("/")
def index():
    # HA ingress injects X-Ingress-Path (e.g. /api/hassio_ingress/abc123)
    # We pass it to the template so the frontend can prefix all API calls.
    ingress_path = request.headers.get("X-Ingress-Path", "").rstrip("/")
    return render_template("index.html", ingress_path=ingress_path)
