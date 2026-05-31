"""Vision routes."""
import logging
from flask import Blueprint, request, jsonify

from db import get_db, images_for, image_url, get_or_create_category, next_box_number
from sse import sse_push

logger = logging.getLogger(__name__)
import base64, mimetypes, io
import requests as http_requests
from flask import abort
from PIL import Image
from config import VISION_BACKEND, ANTHROPIC_API_KEY, OLLAMA_URL, OLLAMA_MODEL, HA_TOKEN, HA_API_URL

bp = Blueprint("vision", __name__)

# ── Vision / Item Identification ──────────────────────────────────────────

IDENTIFY_PROMPT = (
    "You are helping label moving boxes. Look at this photo and identify the "
    "physical item(s) visible. Return ONLY a JSON array of up to 5 short item "
    "name strings, most specific first. Each name should be 1-4 words, suitable "
    "as a box inventory label (e.g. 'Rice cooker', 'Coffee mug', 'HDMI cable'). "
    "No explanations, no markdown — just the raw JSON array."
)

MAX_IDENTIFY_BYTES = 5 * 1024 * 1024  # 5 MB after resize


def compress_image_for_vision(file_bytes: bytes, mime: str) -> tuple[bytes, str]:
    """Resize and compress image to keep API costs low. Returns (bytes, mime)."""
    try:
        img = Image.open(io.BytesIO(file_bytes))
        img = img.convert("RGB")
        # Resize so longest edge <= 1024px
        w, h = img.size
        if max(w, h) > 1024:
            scale = 1024 / max(w, h)
            img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=82, optimize=True)
        return buf.getvalue(), "image/jpeg"
    except Exception as e:
        logger.warning(f"Image compression failed: {e}, sending original")
        return file_bytes, mime


def parse_vision_response(raw: str) -> list[str]:
    """Robustly extract a list of item name strings from a model response.

    Handles: clean JSON arrays, markdown-fenced JSON, prose with bullet/numbered
    lists, newline-separated names, and single-item responses.
    """
    import json, re

    text = raw.strip()

    # 1. Strip markdown code fences (```json ... ``` or ``` ... ```)
    text = re.sub(r"```(?:json)?\s*", "", text).strip()
    text = text.strip("`").strip()

    # 2. Try direct JSON parse
    try:
        result = json.loads(text)
        if isinstance(result, list):
            return [str(s).strip() for s in result if str(s).strip()][:5]
        if isinstance(result, str):
            return [result.strip()] if result.strip() else []
    except (json.JSONDecodeError, ValueError):
        pass

    # 3. Try to extract a JSON array embedded anywhere in the text
    m = re.search(r"\[.*?\]", text, re.DOTALL)
    if m:
        try:
            result = json.loads(m.group(0))
            if isinstance(result, list):
                return [str(s).strip() for s in result if str(s).strip()][:5]
        except (json.JSONDecodeError, ValueError):
            pass

    # 4. Fall back: split on newlines, strip bullets/numbers/quotes
    lines = []
    for line in text.splitlines():
        line = line.strip()
        # Remove leading bullets, numbers, dashes, asterisks
        line = re.sub(r"^[\d]+[.)]\s*", "", line)
        line = re.sub(r"^[-*•]\s*", "", line)
        # Remove surrounding quotes
        line = line.strip('"\'')
        # Skip empty lines or lines that look like prose (long sentences)
        if line and len(line) <= 80 and not line.endswith(":"):
            lines.append(line)
    if lines:
        return lines[:5]

    return []


def identify_via_anthropic(img_bytes: bytes, mime: str, prompt: str = None) -> list[str]:
    import anthropic
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    b64 = base64.standard_b64encode(img_bytes).decode()
    msg = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=256,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}},
                {"type": "text", "text": prompt or IDENTIFY_PROMPT},
            ],
        }],
    )
    raw = msg.content[0].text.strip()
    return parse_vision_response(raw)


def get_ollama_models() -> list[str]:
    """Return list of model names available on the Ollama server, or [] on error."""
    try:
        resp = http_requests.get(f"{OLLAMA_URL}/api/tags", timeout=5)
        resp.raise_for_status()
        return [m.get("name", "") for m in resp.json().get("models", [])]
    except Exception:
        return []


def identify_via_ollama(img_bytes: bytes, mime: str, prompt: str = None) -> list[str]:
    import json
    b64 = base64.standard_b64encode(img_bytes).decode()

    # Check model exists before trying — gives a friendlier error than a raw 404
    available = get_ollama_models()
    # Ollama model names may include a tag (e.g. "llava:latest"); match on prefix
    model_found = any(
        m == OLLAMA_MODEL or m.startswith(OLLAMA_MODEL + ":") or OLLAMA_MODEL.startswith(m.split(":")[0])
        for m in available
    )
    if available and not model_found:
        raise ValueError(
            f"Model '{OLLAMA_MODEL}' is not installed on your Ollama server. "
            f"Available models: {', '.join(available) or 'none'}. "
            f"Run: ollama pull {OLLAMA_MODEL}"
        )

    resp = http_requests.post(
        f"{OLLAMA_URL}/api/generate",
        json={
            "model": OLLAMA_MODEL,
            "prompt": prompt or IDENTIFY_PROMPT,
            "images": [b64],
            "stream": False,
            "options": {"temperature": 0.1},
        },
        timeout=120,
    )
    if resp.status_code == 404:
        raise ValueError(
            f"Model '{OLLAMA_MODEL}' not found on Ollama server at {OLLAMA_URL}. "
            f"Run: ollama pull {OLLAMA_MODEL}"
        )
    resp.raise_for_status()
    raw = resp.json().get("response", "").strip()
    return parse_vision_response(raw)


@bp.route("/api/vision-config", methods=["GET"])
def vision_config():
    """Let the frontend know what's configured, checking Ollama model availability."""
    backend = VISION_BACKEND
    ready = False
    warning = None
    available_models = []

    if backend == "anthropic" and ANTHROPIC_API_KEY:
        ready = True
    elif backend == "ollama" and OLLAMA_URL:
        available_models = get_ollama_models()
        if not available_models:
            # Can't reach server at all
            warning = f"Cannot reach Ollama at {OLLAMA_URL}"
        else:
            model_found = any(
                m == OLLAMA_MODEL or m.startswith(OLLAMA_MODEL + ":")
                or OLLAMA_MODEL.startswith(m.split(":")[0])
                for m in available_models
            )
            if model_found:
                ready = True
            else:
                warning = (
                    f"Model '{OLLAMA_MODEL}' is not installed. "
                    f"Run: ollama pull {OLLAMA_MODEL}  "
                    f"(available: {', '.join(available_models[:5])})"
                )

    return jsonify({
        "backend": backend,
        "ready": ready,
        "model": OLLAMA_MODEL if backend == "ollama" else None,
        "available_models": available_models,
        "warning": warning,
    })


BARCODE_PROMPT = (
    "You are helping label moving boxes. Look at this photo and identify the barcode. "
    "Look up the product name for that barcode and return ONLY a JSON array of up to 3 "
    "short product name strings, most specific first. Each name should be 1-5 words suitable "
    "as a box inventory label (e.g. 'Nespresso Vertuo Next', 'Dyson V11 Vacuum', 'Kindle Paperwhite'). "
    "No explanations, no markdown — just the raw JSON array. "
    "If you cannot read a barcode or identify the product, return []."
)

@bp.route("/api/identify", methods=["POST"])
def identify_item():
    if VISION_BACKEND == "none":
        return jsonify({"error": "Vision backend not configured"}), 503

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    mode = request.form.get("mode", "image")  # "image" or "barcode"
    f = request.files["file"]
    mime = f.mimetype or mimetypes.guess_type(f.filename or "")[0] or "image/jpeg"
    raw_bytes = f.read()

    if len(raw_bytes) > 20 * 1024 * 1024:
        return jsonify({"error": "Image too large (max 20 MB)"}), 413

    img_bytes, img_mime = compress_image_for_vision(raw_bytes, mime)

    prompt = BARCODE_PROMPT if mode == "barcode" else IDENTIFY_PROMPT
    try:
        if VISION_BACKEND == "anthropic":
            if not ANTHROPIC_API_KEY:
                return jsonify({"error": "Anthropic API key not set"}), 503
            names = identify_via_anthropic(img_bytes, img_mime, prompt)
        elif VISION_BACKEND == "ollama":
            names = identify_via_ollama(img_bytes, img_mime, prompt)
        else:
            return jsonify({"error": "Unknown vision backend"}), 503

        if not isinstance(names, list):
            raise ValueError("Model did not return a list")
        # Sanitise — keep only strings, max 5, max 60 chars each
        names = [str(n).strip()[:60] for n in names if n][:5]
        return jsonify({"suggestions": names})

    except Exception as e:
        logger.error(f"Vision identify error ({VISION_BACKEND}): {e}")
        return jsonify({"error": f"Identification failed: {str(e)}"}), 500

# ── UPC Lookup ────────────────────────────────────────────────────────────

@bp.route("/api/items/find-by-name", methods=["GET"])
def find_item_by_name():
    """Find existing items matching a name (case-insensitive).
    Used by barcode flow to detect merge candidates.
    Returns items with their UPC so the frontend can decide:
      - no UPC: offer to merge (save UPC to existing item)
      - different UPC: keep separate (different product variant)
      - same UPC: already merged, use directly
    """
    name = (request.args.get("name") or "").strip()
    if not name:
        return jsonify([])
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT i.id, i.name, i.upc, c.name as category
                FROM items i
                LEFT JOIN categories c ON c.id = i.category_id
                WHERE LOWER(i.name) = LOWER(%s)
            """, (name,))
            return jsonify(cur.fetchall())
    finally:
        conn.close()


@bp.route("/api/upc-lookup", methods=["GET"])
def upc_lookup():
    """Look up a UPC. Checks local item DB first, then external APIs."""
    upc_raw = (request.args.get("upc") or "").strip()
    if not upc_raw:
        return jsonify({"error": "Invalid UPC"}), 400
    # Normalise: strip leading zeros for external lookups but keep raw for DB
    upc = upc_raw.lstrip("0") or upc_raw
    if not upc.isdigit():
        return jsonify({"error": "Invalid UPC"}), 400

    # ── 0. Local DB lookup ────────────────────────────────────────────────────
    conn = get_db()
    local_items = []
    try:
        with conn.cursor() as cur:
            # Match on both raw and normalised (leading zeros stripped)
            cur.execute("""
                SELECT i.id, i.name, i.upc, c.name as category
                FROM items i
                LEFT JOIN categories c ON c.id = i.category_id
                WHERE i.upc = %s OR i.upc = %s
            """, (upc_raw, upc))
            local_items = cur.fetchall()
    finally:
        conn.close()

    if local_items:
        return jsonify({
            "upc": upc,
            "source": "local",
            "items": local_items,          # full item objects with id
            "names": [i["name"] for i in local_items],
        })

    names = []

    # ── 1. Open Food Facts (great for grocery/packaged goods) ────────────────
    try:
        r = http_requests.get(
            f"https://world.openfoodfacts.org/api/v0/product/{upc}.json",
            headers={"User-Agent": "BoxInventoryTracker/1.0"},
            timeout=6,
        )
        if r.status_code == 200:
            data = r.json()
            if data.get("status") == 1:
                p = data.get("product", {})
                # Prefer product_name, fall back to generic name or brands
                name = (p.get("product_name") or p.get("generic_name") or "").strip()
                brand = (p.get("brands") or "").split(",")[0].strip()
                if name:
                    names.append(f"{brand} {name}".strip() if brand and brand.lower() not in name.lower() else name)
                elif brand:
                    names.append(brand)
    except Exception as e:
        logger.debug(f"Open Food Facts lookup failed: {e}")

    # ── 2. UPCitemdb (broader range: electronics, books, household) ──────────
    if not names:
        try:
            r = http_requests.get(
                f"https://api.upcitemdb.com/prod/trial/lookup?upc={upc}",
                headers={"User-Agent": "BoxInventoryTracker/1.0"},
                timeout=6,
            )
            if r.status_code == 200:
                data = r.json()
                for item in (data.get("items") or [])[:3]:
                    title = (item.get("title") or "").strip()
                    if title:
                        names.append(title)
        except Exception as e:
            logger.debug(f"UPCitemdb lookup failed: {e}")

    return jsonify({"upc": upc, "source": "external", "items": [], "names": names[:5]})
