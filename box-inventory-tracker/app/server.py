"""
Box Inventory Tracker — Flask application entry point.

Structure:
  config.py          — environment variable configuration
  db.py              — database connection, init, migrations, shared helpers
  sse.py             — Server-Sent Events broadcaster
  routes/
    boxes.py         — box CRUD + box_items CRUD
    rooms.py         — room CRUD + HA area sync
    items.py         — item CRUD + find-by-name + search
    categories.py    — category CRUD
    images.py        — image upload / serve / delete
    vision.py        — AI identification + UPC lookup
    frontend.py      — index page
"""
import logging
from flask import Flask
from flask_cors import CORS

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# ── Register blueprints ────────────────────────────────────────────────────
from sse import bp as sse_bp
from routes.categories import bp as categories_bp
from routes.rooms       import bp as rooms_bp
from routes.boxes       import bp as boxes_bp
from routes.items       import bp as items_bp
from routes.images      import bp as images_bp
from routes.vision      import bp as vision_bp
from routes.frontend    import bp as frontend_bp
from routes.import_data  import bp as import_bp
from routes.export_reset import bp as export_reset_bp
from routes.metadata    import bp as metadata_bp

app.register_blueprint(sse_bp)
app.register_blueprint(categories_bp)
app.register_blueprint(rooms_bp)
app.register_blueprint(boxes_bp)
app.register_blueprint(items_bp)
app.register_blueprint(images_bp)
app.register_blueprint(vision_bp)
app.register_blueprint(frontend_bp)
app.register_blueprint(import_bp)
app.register_blueprint(export_reset_bp)
app.register_blueprint(metadata_bp)

# ── Startup ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    from db import init_db, migrate_db
    from db import sync_ha_areas
    init_db()
    migrate_db()
    sync_ha_areas()
    app.run(host="0.0.0.0", port=5000, debug=False)
