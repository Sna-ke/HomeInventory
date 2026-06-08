// ── Navigation ─────────────────────────────────────────────────────────────
let _showPanelInProgress = false;
function showPanel(name, writeHash = true) {
  // Guard against re-entrant calls (e.g. hashchange firing mid-showPanel)
  if (_showPanelInProgress) return;
  _showPanelInProgress = true;
  try {
    const panelEl = document.getElementById(`panel-${name}`);
    if (!panelEl) return; // unknown panel

    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tabbar button, .sidebar button').forEach(b => b.classList.remove('active'));
    panelEl.classList.add('active');
    const tab = document.getElementById(`tab-${name}`);
    if (tab) tab.classList.add('active');
    const sideBtn = document.getElementById(`sidebar-${name}`);
    if (sideBtn) sideBtn.classList.add('active');
    document.getElementById('mainContent').scrollTop = 0;

    if (writeHash) {
      // Temporarily remove hashchange listener to prevent re-entrance
      window.removeEventListener('hashchange', applyNav);
      location.hash = name;
      saveNav(name);
      // Re-attach after a tick
      setTimeout(() => window.addEventListener('hashchange', applyNav), 0);
    }

    if (name === 'wizard') loadWizard();
    else if (name === 'dashboard') loadDashboard();
    else if (name === 'boxes') loadBoxes();
    else if (name === 'rooms') loadRooms();
    else if (name === 'items') loadItems();
    else if (name === 'categories') loadCategories();
    else if (name === 'settings') { loadCreditCardsSettings(); loadQRURLSettings(); }

    // Clear search box when navigating away from search results
    if (name !== 'search') {
      const gs = document.getElementById('globalSearch');
      if (gs && gs.value) gs.value = '';
    }
    // Show FAB only on Boxes panel
    const fab = document.getElementById('boxes-fab');
    if (fab) fab.style.display = (name === 'boxes') ? 'flex' : 'none';
  } finally {
    _showPanelInProgress = false;
  }
}

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

document.querySelectorAll('.modal-backdrop').forEach(bd => {
  bd.addEventListener('click', e => { if (e.target === bd) bd.classList.remove('open'); });
});

// ── Global Search ──────────────────────────────────────────────────────────
function handleSearch(q) {
  clearTimeout(searchTimer);
  if (!q.trim()) { showPanel('dashboard'); return; }
  searchTimer = setTimeout(() => doSearch(q), 300);
}

async function doSearch(q) {
  const div = document.getElementById('search-results');
  div.innerHTML = '<div style="color:var(--muted);font-family:var(--mono);font-size:12px;padding:8px;">Searching…</div>';

  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tabbar button, .sidebar button').forEach(b => b.classList.remove('active'));
  document.getElementById('panel-search').classList.add('active');
  document.getElementById('mainContent').scrollTop = 0;

  const results = await api(`/api/search?q=${encodeURIComponent(q)}`);

  if (!results.length) {
    div.innerHTML = `<div class="empty">No results for "${esc(q)}".</div>`;
    return;
  }

  // Group by priority bucket, then by location within each bucket
  const buckets = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  results.forEach(r => (buckets[r.priority] || buckets[5]).push(r));

  const bucketMeta = {
    1: { label: 'Item name',   icon: '📦' },
    2: { label: 'Category',    icon: '🏷️' },
    3: { label: 'Details',     icon: '🔍' },
    4: { label: 'Box',         icon: '📦' },
    5: { label: 'Room',        icon: '🏠' },
  };

  div.innerHTML = '';

  [1, 2, 3, 4, 5].forEach(pri => {
    const rows = buckets[pri];
    if (!rows.length) return;

    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom:20px;';

    const hdr = document.createElement('div');
    hdr.style.cssText = 'font-size:11px;font-weight:700;letter-spacing:1.5px;' +
      'text-transform:uppercase;color:var(--muted);margin-bottom:8px;';
    hdr.textContent = bucketMeta[pri].label + ' match' + (rows.length > 1 ? 'es' : '');
    section.appendChild(hdr);

    rows.forEach(r => {
      const card = document.createElement('div');
      card.className = 'result-row';
      card.style.cssText = 'cursor:pointer;';

      // Location breadcrumb
      const loc = document.createElement('div');
      loc.className = 'result-box';
      const locParts = [];
      if (r.room_name) locParts.push('🏠 ' + r.room_name);
      if (r.box_id)    locParts.push('📦 BOX ' + r.box_number + (r.box_label ? ' · ' + r.box_label : ''));
      if (r.shelf_location) locParts.push('📌 ' + r.shelf_location);
      loc.textContent = locParts.join('  ›  ') || '(no location)';
      card.appendChild(loc);

      // Main content row
      const body = document.createElement('div');
      body.style.cssText = 'display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;';

      if (r.item_name) {
        // Highlight the matching portion
        const nameEl = document.createElement('div');
        nameEl.className = 'result-label';
        nameEl.style.flex = '1';
        const lq = q.toLowerCase();
        const ln = r.item_name.toLowerCase();
        const idx = ln.indexOf(lq);
        if (idx >= 0) {
          nameEl.innerHTML =
            esc(r.item_name.slice(0, idx)) +
            '<mark style="background:var(--accent);color:#000;padding:0 1px;">' +
            esc(r.item_name.slice(idx, idx + q.length)) +
            '</mark>' +
            esc(r.item_name.slice(idx + q.length));
        } else {
          nameEl.textContent = r.item_name;
        }
        body.appendChild(nameEl);
      } else if (r.result_type === 'box') {
        const nameEl = document.createElement('div');
        nameEl.className = 'result-label';
        nameEl.textContent = r.box_label || 'BOX ' + r.box_number;
        body.appendChild(nameEl);
      } else if (r.result_type === 'room') {
        const nameEl = document.createElement('div');
        nameEl.className = 'result-label';
        nameEl.textContent = r.room_name;
        body.appendChild(nameEl);
      }

      // Meta chips
      const chips = document.createElement('div');
      chips.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;align-items:center;';
      if (r.category) {
        const cat = document.createElement('span');
        cat.className = 'chip cat';
        cat.textContent = r.category;
        chips.appendChild(cat);
      }
      if (r.quantity > 1) {
        const qty = document.createElement('span');
        qty.className = 'chip';
        qty.textContent = '×' + r.quantity;
        chips.appendChild(qty);
      }
      if (r.serial_number) {
        const sn = document.createElement('span');
        sn.className = 'chip';
        sn.style.fontFamily = 'var(--mono)';
        sn.textContent = 'S/N: ' + r.serial_number;
        chips.appendChild(sn);
      }
      if (r.model_number) {
        const mn = document.createElement('span');
        mn.className = 'chip';
        mn.textContent = r.model_number;
        chips.appendChild(mn);
      }
      body.appendChild(chips);
      card.appendChild(body);

      // Notes line
      if (r.placement_notes) {
        const notes = document.createElement('div');
        notes.style.cssText = 'font-size:12px;color:var(--muted);margin-top:3px;font-style:italic;';
        notes.textContent = r.placement_notes;
        card.appendChild(notes);
      }

      // Click action — navigate to the location
      card.addEventListener('click', () => {
        document.getElementById('globalSearch').value = '';
        if (r.box_id) {
          openBoxDetail(r.box_id);
        } else if (r.room_id) {
          showPanel('rooms');
          setTimeout(() => {
            const expand = document.getElementById(`room-expand-${r.room_id}`);
            const hdr2   = expand?.previousElementSibling;
            const chev   = hdr2?.querySelector('.cat-chevron');
            if (expand && hdr2 && chev && !expand.classList.contains('open')) {
              toggleRoomExpand(r.room_id, hdr2, chev, expand);
            }
            expand?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 150);
        }
      });

      section.appendChild(card);
    });

    div.appendChild(section);
  });

  // Summary count
  const total = results.length;
  const summary = document.createElement('div');
  summary.style.cssText = 'font-size:12px;color:var(--muted);font-family:var(--mono);' +
    'padding-top:8px;border-top:1px solid var(--border);';
  summary.textContent = `${total} result${total !== 1 ? 's' : ''} for "${q}"`;
  div.appendChild(summary);
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

  const panels = ['wizard', 'dashboard', 'boxes', 'rooms', 'items', 'categories', 'settings'];
  const target = panels.includes(loc) ? loc : 'dashboard';
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
    scheduleRefresh('dashboard', () => loadDashboard());
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
