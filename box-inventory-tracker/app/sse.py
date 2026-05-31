"""Server-Sent Events broadcaster — push change notifications to connected browsers."""
import threading
import queue
import json as _json_mod
import logging

from flask import Blueprint, request, Response, stream_with_context

logger = logging.getLogger(__name__)
bp = Blueprint("sse", __name__)

# ── Server-Sent Events broadcaster ────────────────────────────────────────────
# Each connected client gets a queue. When data changes, we push an event to all.
_sse_clients: list[queue.Queue] = []
_sse_lock = threading.Lock()

def sse_push(event_type: str, payload: dict | None = None):
    """Push a change notification to all connected SSE clients."""
    data = _json_mod.dumps({"type": event_type, **(payload or {})})
    with _sse_lock:
        client_count = len(_sse_clients)
        dead = []
        for q in _sse_clients:
            try:
                q.put_nowait(data)
            except queue.Full:
                dead.append(q)
        for q in dead:
            _sse_clients.remove(q)
    logger.info(f"SSE push: {event_type} → {client_count} client(s)")

@bp.route("/api/events")
def sse_stream():
    """SSE endpoint — clients connect once and receive change notifications."""
    q: queue.Queue = queue.Queue(maxsize=50)
    with _sse_lock:
        _sse_clients.append(q)

    logger.info(f"SSE client connected (total: {len(_sse_clients)})")
    def generate():
        # Send an initial ping so the client knows it's connected
        yield "event: ping\ndata: {}\n\n"
        try:
            while True:
                try:
                    data = q.get(timeout=25)
                    yield f"event: change\ndata: {data}\n\n"
                except queue.Empty:
                    # Keepalive comment to prevent proxy timeouts
                    yield ": keepalive\n\n"
        except GeneratorExit:
            pass
        finally:
            with _sse_lock:
                try:
                    _sse_clients.remove(q)
                except ValueError:
                    pass

    ingress_path = request.headers.get("X-Ingress-Path", "").rstrip("/")
    headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",  # disable nginx buffering (important for HA ingress)
    }
    return Response(stream_with_context(generate()), headers=headers)
