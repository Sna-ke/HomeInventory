"""Application configuration — all env var reads in one place."""
import os
from pathlib import Path

DB_NAME     = os.environ.get("DB_NAME", "box_inventory")
UPLOAD_DIR  = Path(os.environ.get("UPLOAD_DIR", "/data/images"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_MIME = {"image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif"}
MAX_IMAGE_BYTES = 20 * 1024 * 1024  # 20 MB

DB_CONFIG = {
    "host":     os.environ.get("DB_HOST", "localhost"),
    "port":     int(os.environ.get("DB_PORT", 3306)),
    "user":     os.environ.get("DB_USER", "root"),
    "password": os.environ.get("DB_PASSWORD", ""),
    "db":       DB_NAME,
    "charset":  "utf8mb4",
    "cursorclass": None,  # set in db.py after pymysql import
}

HA_TOKEN    = os.environ.get("HA_TOKEN", "").strip()
HA_API_URL  = "http://supervisor/core/api"

VISION_BACKEND  = os.environ.get("VISION_BACKEND", "none").lower()
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
OLLAMA_URL      = os.environ.get("OLLAMA_URL", "http://homeassistant.local:11434").rstrip("/")
OLLAMA_MODEL    = os.environ.get("OLLAMA_MODEL", "llava").strip()
