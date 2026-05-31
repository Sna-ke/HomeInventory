// ── Navigation ─────────────────────────────────────────────────────────────
function showPanel(name, writeHash = true) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tabbar button, .sidebar button').forEach(b => b.classList.remove('active'));
  document.getElementById(`panel-${name}`).classList.add('active');
  const tab = document.getElementById(`tab-${name}`);
  if (tab) tab.classList.add('active');
  const sideBtn = document.getElementById(`sidebar-${name}`);
  if (sideBtn) sideBtn.classList.add('active');
  document.getElementById('mainContent').scrollTop = 0;

  // Write URL hash and persist to sessionStorage (fallback for HA ingress)
  if (writeHash) {
    location.hash = name;
    saveNav(name);
  }

  if (name === 'boxes') loadBoxes();
  else if (name === 'rooms') loadRooms();
  else if (name === 'items') loadItems();
  else if (name === 'categories') loadCategories();
  else if (name === 'settings') loadCreditCardsSettings();
}

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

document.querySelectorAll('.modal-backdrop').forEach(bd => {
  bd.addEventListener('click', e => { if (e.target === bd) bd.classList.remove('open'); });
});

// ── Global Search ──────────────────────────────────────────────────────────
function handleSearch(q) {
  clearTimeout(searchTimer);
  if (!q.trim()) { showPanel('boxes'); return; }
  searchTimer = setTimeout(() => doSearch(q), 300);
}

async function doSearch(q) {
  const results = await api(`/api/search?q=${encodeURIComponent(q)}`);
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tabbar button, .sidebar button').forEach(b => b.classList.remove('active'));
  document.getElementById('panel-search').classList.add('active');
  document.getElementById('mainContent').scrollTop = 0;

  const div = document.getElementById('search-results');
  if (!results.length) { div.innerHTML = '<div class="empty">No results.</div>'; return; }

  const byBox = {};
  results.forEach(r => {
    if (!byBox[r.box_id]) byBox[r.box_id] = { ...r, matches:[] };
    byBox[r.box_id].matches.push(r);
  });

  div.innerHTML = Object.values(byBox).map(b => `
    <div class="result-row" onclick="openBoxDetail(${b.box_id})">
      <div class="result-box">BOX ${b.box_number} · 📍 ${esc(b.room_name||'No room')}</div>
      <div class="result-label">${esc(b.label||'Unlabelled')}</div>
      <div class="result-items">
        ${b.matches.map(m=>`<span class="chip">${esc(m.item_name)} ×${m.quantity}</span>`).join('')}
      </div>
    </div>
  `).join('');
}

// Close autocomplete lists on outside tap
document.addEventListener('click', e => {
  if (!e.target.closest('.ac-wrap'))
    document.querySelectorAll('.ac-list').forEach(l => l.classList.remove('open'));
});

// ── Theme ──────────────────────────────────────────────────────────────────
function initTheme() {
  // Respect saved preference; fall back to system setting
  const saved = localStorage.getItem('boxtrack-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const useDark = saved ? saved === 'dark' : prefersDark;
  applyTheme(useDark ? 'dark' : 'light', false);

  // Live-update if system setting changes and user hasn't overridden
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    if (!localStorage.getItem('boxtrack-theme')) {
      applyTheme(e.matches ? 'dark' : 'light', false);
    }
  });
}

function applyTheme(mode, save = true) {
  const root = document.documentElement;
  const btn = document.getElementById('theme-toggle');
  if (mode === 'light') {
    root.classList.add('light');
    root.classList.remove('dark');
    if (btn) btn.textContent = '☀️';
  } else {
    root.classList.add('dark');
    root.classList.remove('light');
    if (btn) btn.textContent = '🌙';
  }
  if (save) localStorage.setItem('boxtrack-theme', mode);
}

function toggleTheme() {
  const isLight = document.documentElement.classList.contains('light');
  applyTheme(isLight ? 'dark' : 'light');
}

// ── Navigation state ──────────────────────────────────────────────────────
// HA ingress may strip URL fragments before or during page load, so we persist
// the current location in sessionStorage as a fallback.
// Priority: 1) ?box=N query param (QR codes)  2) URL hash  3) sessionStorage

const NAV_KEY = 'boxtrack_nav';

function saveNav(loc) {
  try { sessionStorage.setItem(NAV_KEY, loc); } catch(e) {}
}

function readNav() {
  // QR code param wins over everything
  const params = new URLSearchParams(location.search);
  const qrBox = params.get('box');
  if (qrBox) return `box/${qrBox}`;

  // URL hash (works when not behind ingress, or when fragment survives)
  const hash = location.hash.slice(1);
  if (hash) return hash;

  // sessionStorage fallback (survives HA ingress page loads)
  try { return sessionStorage.getItem(NAV_KEY) || ''; } catch(e) { return ''; }
}

function applyNav() {
  const loc = readNav();

  if (loc.startsWith('box/')) {
    const id = parseInt(loc.split('/')[1]);
    if (id) { openBoxDetail(id); return; }
  }

  const panels = ['boxes', 'rooms', 'items', 'categories'];
  const target = panels.includes(loc) ? loc : 'boxes';
  showPanel(target, false);
}

window.addEventListener('hashchange', applyNav);
window.addEventListener('popstate',   applyNav);

// ── SSE live-sync ──────────────────────────────────────────────────────────
let _sseSource = null;
let _sseRetryMs = 2000;
let _sseCurrentPanel = () => document.querySelector('.panel.active')?.id?.replace('panel-', '') || 'boxes';

function sseConnect() {
  if (_sseSource) { _sseSource.close(); _sseSource = null; }
  const url = API_BASE + '/api/events';
  console.log('[SSE] Connecting to', url);
  _sseSource = new EventSource(url);

  _sseSource.onopen = () => {
    console.log('[SSE] EventSource opened, readyState=', _sseSource.readyState);
  };

  _sseSource.addEventListener('ping', () => {
    console.log('[SSE] Connected (ping received)');
    _sseRetryMs = 2000;
  });

  _sseSource.addEventListener('change', e => {
    console.log('[SSE] Change event received:', e.data);
    try {
      const ev = JSON.parse(e.data);
      handleRemoteChange(ev);
    } catch(err) {
      console.warn('[SSE] Parse error:', err);
    }
  });

  _sseSource.onerror = (err) => {
    console.warn('[SSE] Error/disconnected, retrying in', _sseRetryMs, 'ms');
    _sseSource.close(); _sseSource = null;
    setTimeout(sseConnect, _sseRetryMs);
    _sseRetryMs = Math.min(_sseRetryMs * 2, 30000);
  };
}

// Debounced SSE refresh — batch rapid changes into one refresh per panel
const _ssePending = {};
function scheduleRefresh(panel, fn) {
  clearTimeout(_ssePending[panel]);
  _ssePending[panel] = setTimeout(fn, 400);
}

function handleRemoteChange(ev) {
  const type = ev.type;
  const panel = _sseCurrentPanel();
  console.log('[SSE] handleRemoteChange type=' + type + ' panel=' + panel);

  if (panel === 'boxes' && (type === 'boxes' || type === 'items')) {
    // Re-fetch and re-render boxes grid/list (no expand state to preserve)
    scheduleRefresh('boxes', () => loadBoxes());

  } else if (panel === 'rooms' && type === 'rooms') {
    // Room structure changed — full reload
    scheduleRefresh('rooms', () => loadRooms());
  } else if (panel === 'rooms' && (type === 'boxes' || type === 'items')) {
    // Box contents changed — update open boxes in-place, preserve expand state
    scheduleRefresh('rooms', () => refreshOpenRoomBoxes());

  } else if (panel === 'items' && (type === 'items' || type === 'categories' || type === 'boxes')) {
    // Re-fetch items, re-apply filters, re-open any expanded row
    scheduleRefresh('items', () => refreshItemsInPlace());

  } else if (panel === 'categories' && (type === 'categories' || type === 'items')) {
    // Re-fetch categories, re-render, re-open any expanded category
    scheduleRefresh('categories', () => refreshCategoriesInPlace());

  } else if (panel === 'box-detail' && type === 'boxes') {
    if (currentBoxId && (ev.box_id === undefined || ev.box_id === currentBoxId)) {
      scheduleRefresh('box-detail', () => refreshBoxItemsInPlace(currentBoxId));
    }
  }

  // Keep room filter dropdown current on room changes (lightweight, any panel)
  if (type === 'rooms') {
    scheduleRefresh('rooms-filter', () => api('/api/rooms').then(r => {
      rooms = r;
      const f = document.getElementById('roomFilter');
      if (!f) return;
      const prev = f.value;
      f.innerHTML = '<option value="">All Rooms</option>' +
        rooms.map(rm => `<option value="${rm.id}" ${prev==rm.id?'selected':''}>${esc(rm.name)}</option>`).join('');
    }).catch(() => {}));
  }
}

// ── Init ───────────────────────────────────────────────────────────────────
(async () => {
  initTheme();
  await loadRooms();
  applyNav();
  loadVisionConfig(); // non-blocking — vision is optional
  sseConnect();       // live sync — non-blocking
})();
