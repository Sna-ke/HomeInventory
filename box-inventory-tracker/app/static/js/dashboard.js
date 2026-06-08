// ── Dashboard ─────────────────────────────────────────────────────────────────

async function loadDashboard() {
  const el = document.getElementById('dashboard-content');
  if (!el) return;
  el.innerHTML = '<div style="padding:24px;color:var(--muted);font-family:var(--mono);font-size:13px;">Loading…</div>';
  try {
    const d = await api('/api/dashboard');
    renderDashboard(el, d);
  } catch(e) {
    el.innerHTML = `<div style="padding:24px;color:#c33;">Failed to load dashboard: ${esc(e.message)}</div>`;
  }
}

function renderDashboard(el, d) {
  const t = d.totals;
  const totalThings = t.items_packed + t.items_placed;
  const packedPct = t.item_types > 0
    ? Math.min(100, Math.round(t.distinct_types_packed / t.item_types * 100))
    : 0;

  el.innerHTML = '';

  // ── Hero stats row ────────────────────────────────────────────────────────
  const hero = document.createElement('div');
  hero.className = 'dash-hero';
  hero.innerHTML = `
    <div class="dash-stat">
      <div class="dash-stat-num">${t.boxes}</div>
      <div class="dash-stat-label">Boxes</div>
    </div>
    <div class="dash-stat">
      <div class="dash-stat-num">${t.rooms}</div>
      <div class="dash-stat-label">Rooms</div>
    </div>
    <div class="dash-stat">
      <div class="dash-stat-num">${totalThings}</div>
      <div class="dash-stat-label">Items</div>
    </div>
    <div class="dash-stat">
      <div class="dash-stat-num">${t.item_types}</div>
      <div class="dash-stat-label">Types</div>
    </div>`;
  el.appendChild(hero);

  // ── Progress ring ─────────────────────────────────────────────────────────
  const progress = document.createElement('div');
  progress.className = 'dash-progress-section';

  const circumference = 2 * Math.PI * 52; // r=52
  const offset = circumference * (1 - packedPct / 100);

  progress.innerHTML = `
    <div class="dash-progress-wrap">
      <svg class="dash-ring" viewBox="0 0 120 120" width="120" height="120">
        <circle cx="60" cy="60" r="52" fill="none" stroke="var(--border)" stroke-width="10"/>
        <circle cx="60" cy="60" r="52" fill="none" stroke="var(--accent)" stroke-width="10"
          stroke-dasharray="${circumference.toFixed(1)}"
          stroke-dashoffset="${circumference.toFixed(1)}"
          stroke-linecap="round"
          transform="rotate(-90 60 60)"
          class="dash-ring-fill"
          data-offset="${offset.toFixed(1)}"
          style="transition:stroke-dashoffset 1.2s cubic-bezier(.4,0,.2,1);"/>
      </svg>
      <div class="dash-ring-label">
        <div class="dash-ring-pct">${packedPct}%</div>
        <div class="dash-ring-sub">catalogued</div>
      </div>
    </div>
    <div class="dash-progress-detail">
      <div class="dash-progress-line">
        <span class="dash-progress-key">Packed</span>
        <span class="dash-progress-val">${t.items_packed} items in ${t.boxes} box${t.boxes!==1?'es':''}</span>
      </div>
      <div class="dash-progress-line">
        <span class="dash-progress-key">Placed</span>
        <span class="dash-progress-val">${t.items_placed} items in rooms directly</span>
      </div>
      <div class="dash-progress-line">
        <span class="dash-progress-key">Types tracked</span>
        <span class="dash-progress-val">${t.distinct_types_packed} of ${t.item_types}</span>
      </div>
      ${t.empty_boxes > 0 ? `<div class="dash-progress-line dash-warn">
        <span class="dash-progress-key">⚠️ Empty boxes</span>
        <span class="dash-progress-val">${t.empty_boxes}</span>
      </div>` : ''}
      ${t.unassigned_boxes > 0 ? `<div class="dash-progress-line dash-warn">
        <span class="dash-progress-key">⚠️ No room assigned</span>
        <span class="dash-progress-val">${t.unassigned_boxes} box${t.unassigned_boxes!==1?'es':''}</span>
      </div>` : ''}
    </div>`;
  el.appendChild(progress);

  // Animate the ring after paint
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const fill = el.querySelector('.dash-ring-fill');
    if (fill) fill.style.strokeDashoffset = fill.dataset.offset;
  }));

  // ── Quick actions ─────────────────────────────────────────────────────────
  const qa = document.createElement('div');
  qa.className = 'dash-actions';
  qa.innerHTML = `
    <button class="dash-action-btn primary" onclick="openPackingMode()">
      <span>⚡</span>Start Packing
    </button>
    <button class="dash-action-btn" onclick="openQuickAddItem()">
      <span>＋</span>Add Item
    </button>
    <button class="dash-action-btn" onclick="showPanel('boxes')">
      <span>📦</span>View Boxes
    </button>
    <button class="dash-action-btn" onclick="document.getElementById('globalSearch').focus();showPanel('search') ">
      <span>🔍</span>Find Something
    </button>`;
  el.appendChild(qa);

  // ── Rooms breakdown ───────────────────────────────────────────────────────
  if (d.rooms.length) {
    const sec = document.createElement('div');
    sec.className = 'dash-section';
    const hdr = document.createElement('div');
    hdr.className = 'dash-section-hdr';
    hdr.textContent = 'Rooms';
    sec.appendChild(hdr);

    const grid = document.createElement('div');
    grid.className = 'dash-room-grid';

    d.rooms.forEach(r => {
      const total = r.item_count + r.placed_count;
      const card = document.createElement('div');
      card.className = 'dash-room-card';
      card.onclick = () => showPanel('rooms');

      const isEmpty = r.box_count === 0 && r.placed_count === 0;
      const statusDot = isEmpty ? '⚪' : '🟢';

      card.innerHTML = `
        <div class="dash-room-name">${statusDot} ${esc(r.name)}</div>
        <div class="dash-room-stats">
          ${r.box_count > 0 ? `<span class="dash-room-chip box">${r.box_count} box${r.box_count!==1?'es':''}</span>` : ''}
          ${total > 0 ? `<span class="dash-room-chip item">${total} item${total!==1?'s':''}</span>` : ''}
          ${isEmpty ? `<span class="dash-room-chip empty">empty</span>` : ''}
        </div>`;
      grid.appendChild(card);
    });
    sec.appendChild(grid);
    el.appendChild(sec);
  }

  // ── Top categories ────────────────────────────────────────────────────────
  if (d.top_cats.length) {
    const sec = document.createElement('div');
    sec.className = 'dash-section';
    const hdr = document.createElement('div');
    hdr.className = 'dash-section-hdr';
    hdr.textContent = 'Top Categories Packed';
    sec.appendChild(hdr);

    const maxQty = d.top_cats[0].qty || 1;
    const bars = document.createElement('div');
    bars.className = 'dash-bars';

    d.top_cats.forEach(c => {
      const pct = Math.round(c.qty / maxQty * 100);
      const row = document.createElement('div');
      row.className = 'dash-bar-row';
      row.innerHTML = `
        <div class="dash-bar-label">${esc(c.name || 'Uncategorised')}</div>
        <div class="dash-bar-track">
          <div class="dash-bar-fill" style="width:0%" data-pct="${pct}"></div>
        </div>
        <div class="dash-bar-qty">${c.qty}</div>`;
      bars.appendChild(row);
    });
    sec.appendChild(bars);
    el.appendChild(sec);

    // Animate bars
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.querySelectorAll('.dash-bar-fill').forEach(b => {
        b.style.transition = 'width 0.8s cubic-bezier(.4,0,.2,1)';
        b.style.width = b.dataset.pct + '%';
      });
    }));
  }

  // ── Recent activity ───────────────────────────────────────────────────────
  if (d.recent.length) {
    const sec = document.createElement('div');
    sec.className = 'dash-section';
    const hdr = document.createElement('div');
    hdr.className = 'dash-section-hdr';
    hdr.textContent = 'Recently Packed';
    sec.appendChild(hdr);

    const list = document.createElement('div');
    list.className = 'dash-recent-list';
    d.recent.forEach(item => {
      const row = document.createElement('div');
      row.className = 'dash-recent-row';
      row.style.cursor = 'pointer';
      row.onclick = () => openBoxDetail(item.box_number);
      const dest = item.room_name
        ? `${item.room_name} › BOX ${item.box_number}${item.box_label ? ' · ' + item.box_label : ''}`
        : `BOX ${item.box_number}${item.box_label ? ' · ' + item.box_label : ''}`;
      row.innerHTML = `
        <div class="dash-recent-name">${esc(item.item_name)}</div>
        <div class="dash-recent-dest">${esc(dest)}</div>
        ${item.quantity > 1 ? `<div class="dash-recent-qty">×${item.quantity}</div>` : ''}`;
      list.appendChild(row);
    });
    sec.appendChild(list);
    el.appendChild(sec);
  }

  // Bottom padding
  const pad = document.createElement('div');
  pad.style.height = '32px';
  el.appendChild(pad);
}
