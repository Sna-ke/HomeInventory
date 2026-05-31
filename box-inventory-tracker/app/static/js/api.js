// ── API base path (handles HA ingress subpath) ────────────────────────────
// Jinja injects the ingress prefix; empty string when accessed directly.
async function api(path, opts = {}) {
  const res = await fetch(API_BASE + path, {
    headers: opts.body && !(opts.body instanceof FormData)
      ? { 'Content-Type': 'application/json' } : {},
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function toast(msg, isErr = false) {
  const t = document.createElement('div');
  t.textContent = msg;
  Object.assign(t.style, {
    position:'fixed', bottom:'calc(var(--tab-h) + var(--safe-bottom) + 12px)',
    left:'50%', transform:'translateX(-50%)', zIndex:'999',
    padding:'10px 18px',
    background: isErr ? 'var(--danger)' : 'var(--accent)',
    color:'#000', fontFamily:'var(--sans)', fontWeight:'700',
    fontSize:'14px', letterSpacing:'1px',
    boxShadow:'0 4px 20px rgba(0,0,0,.4)',
    whiteSpace:'nowrap', maxWidth:'90vw', overflow:'hidden', textOverflow:'ellipsis',
  });
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}
