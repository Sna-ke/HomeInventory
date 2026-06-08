// ── Packing Context ───────────────────────────────────────────────────────
const PACKING_CONTEXTS = {
  move: {
    icon: '🚛',
    label: 'Moving Home',
    hint: 'Pack room-by-room, label every box, inventory the valuables.',
    defaultBoxType: 'inventory',
    suggestion: 'Start with an essentials box — things you need on day one.',
    phases: ['packing', 'moving_day', 'settling'],
  },
  storage: {
    icon: '🏚️',
    label: 'Storage Locker',
    hint: 'Long-term retrieval matters. Clear labels and photos are critical.',
    defaultBoxType: 'quick',
    suggestion: 'Put things you need soonest near the front. Label sides, not tops.',
    phases: ['packing'],
  },
  travel: {
    icon: '✈️',
    label: 'Travel / Trip',
    hint: 'Pack by activity or day. Flag anything irreplaceable.',
    defaultBoxType: 'inventory',
    suggestion: 'Flag your passport, medications, and chargers so they are always findable.',
    phases: ['packing'],
  },
  organize: {
    icon: '🏠',
    label: 'Home Organisation',
    hint: 'Track where things actually live. Find anything in seconds.',
    defaultBoxType: 'inventory',
    suggestion: 'Use rooms to mirror your home — one room per shelf unit or area.',
    phases: ['packing'],
  },
};

function getPackingContext() {
  return localStorage.getItem('packingContext') || null;
}

function setPackingContext(key) {
  localStorage.setItem('packingContext', key);
  loadDashboard();
}

function startWizard(contextKey) {
  setPackingContext(contextKey);
  showPanel('wizard');
}

function renderContextBanner(el) {
  const ctx = getPackingContext();
  const banner = document.createElement('div');
  banner.className = 'dash-context-banner';

  if (!ctx) {
    // Question — no context chosen yet
    banner.innerHTML = `
      <div class="dash-context-question">
        <div class="dash-context-q-text">What are you packing for?</div>
        <div class="dash-context-options">
          ${Object.entries(PACKING_CONTEXTS).map(([key, c]) => `
            <button class="dash-context-opt" onclick="startWizard('${key}')">
              <span class="dash-context-opt-icon">${c.icon}</span>
              <span class="dash-context-opt-label">${c.label}</span>
            </button>
          `).join('')}
        </div>
      </div>`;
  } else {
    // Context set — show header with change option
    const c = PACKING_CONTEXTS[ctx];
    // Phase pills for contexts that have multiple phases
    const phasePills = (c.phases && c.phases.length > 1)
      ? `<div class="wiz-phase-pills" style="margin-top:6px;">
          ${c.phases.map(p => {
            const label = p === 'packing' ? 'Packing' : p === 'moving_day' ? 'Moving Day' : 'Settling In';
            const icon  = p === 'packing' ? '📦' : p === 'moving_day' ? '🚛' : '🏠';
            return `<button class="wiz-phase-pill" onclick="openWizardPhase('${p}')">${icon} ${label}</button>`;
          }).join('')}
        </div>` : '';
    banner.innerHTML = `
      <div class="dash-context-set">
        <div class="dash-context-set-left">
          <span class="dash-context-icon">${c.icon}</span>
          <div>
            <div class="dash-context-set-label">${c.label}</div>
            <div class="dash-context-set-hint">${c.hint}</div>
            ${phasePills}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;flex-shrink:0;">
          <button class="dash-action-btn primary" style="font-size:12px;padding:6px 12px;"
            onclick="showPanel('wizard')">Resume →</button>
          <button class="dash-context-change" onclick="setPackingContext_clear()">Change</button>
        </div>
      </div>
      ${c.suggestion ? `<div class="dash-context-tip">💡 ${c.suggestion}</div>` : ''}`;
  }

  el.appendChild(banner);
}

function setPackingContext_clear() {
  localStorage.removeItem('packingContext');
  // Clear wizard session too
  api('/api/wizard/session', {method:'DELETE'}).catch(()=>{});
  loadDashboard();
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

async function loadDashboard() {
  const el = document.getElementById('dashboard-content');
  if (!el) return;
  el.innerHTML = '<div style="padding:24px;color:var(--muted);font-family:var(--mono);font-size:13px;">Loading…</div>';
  try {
    const [d, wizSession] = await Promise.all([
      api('/api/dashboard'),
      api('/api/wizard/session').catch(() => null),
    ]);
    renderDashboard(el, d, wizSession);
  } catch(e) {
    el.innerHTML = `<div style="padding:24px;color:#c33;">Failed to load dashboard: ${esc(e.message)}</div>`;
  }
}

// ── Category pie chart SVG ────────────────────────────────────────────────────
function makeCategoryPieChart(cats) {
  const wrap = document.createElement('div');
  wrap.className = 'dash-pie-wrap';

  const total = cats.reduce((s, c) => s + c.qty, 0);
  if (!total) { wrap.textContent = 'Nothing packed yet'; return wrap; }

  // Accent palette — cycle through accent + muted variants
  const palette = [
    'var(--accent)', '#4a9', '#6af', '#f4a', '#fa6',
    '#a6f', '#6fa', '#f66', '#66f', '#aaa',
  ];

  // Build pie slices
  const size = 140;
  const cx = size / 2, cy = size / 2, r = 54;
  let angle = -Math.PI / 2;
  const slices = [];
  cats.slice(0, 10).forEach((c, i) => {
    const frac  = c.qty / total;
    const start = angle;
    angle += frac * 2 * Math.PI;
    slices.push({ ...c, frac, start, end: angle, color: palette[i % palette.length] });
  });

  // SVG pie
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.style.flexShrink = '0';

  slices.forEach(s => {
    const x1 = cx + r * Math.cos(s.start);
    const y1 = cy + r * Math.sin(s.start);
    const x2 = cx + r * Math.cos(s.end);
    const y2 = cy + r * Math.sin(s.end);
    const large = s.frac > 0.5 ? 1 : 0;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large},1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`);
    path.setAttribute('fill', s.color);
    path.setAttribute('stroke', 'var(--bg)');
    path.setAttribute('stroke-width', '1.5');
    svg.appendChild(path);
  });

  // Centre label
  const totalText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  totalText.setAttribute('x', cx); totalText.setAttribute('y', cy - 4);
  totalText.setAttribute('text-anchor', 'middle');
  totalText.setAttribute('font-size', '18'); totalText.setAttribute('font-weight', '900');
  totalText.setAttribute('fill', 'var(--accent)');
  totalText.textContent = total;
  svg.appendChild(totalText);
  const sub = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  sub.setAttribute('x', cx); sub.setAttribute('y', cy + 14);
  sub.setAttribute('text-anchor', 'middle');
  sub.setAttribute('font-size', '9'); sub.setAttribute('fill', 'var(--muted)');
  sub.textContent = 'items';
  svg.appendChild(sub);

  // Legend
  const legend = document.createElement('div');
  legend.className = 'dash-pie-legend';
  slices.forEach(s => {
    const row = document.createElement('div');
    row.className = 'dash-pie-legend-row';
    row.innerHTML = `
      <span class="dash-pie-swatch" style="background:${s.color};"></span>
      <span class="dash-pie-cat">${esc(s.name || 'Uncategorised')}</span>
      <span class="dash-pie-qty">${s.qty}</span>`;
    legend.appendChild(row);
  });

  wrap.appendChild(svg);
  wrap.appendChild(legend);
  return wrap;
}

function renderDashboard(el, d, wizSession) {
  const t = d.totals;
  el.innerHTML = '';
  renderContextBanner(el);
  const ctx = getPackingContext();
  const totalThings = t.items_packed + t.items_placed;
  const packedPct = t.item_types > 0
    ? Math.min(100, Math.round(t.distinct_types_packed / t.item_types * 100))
    : 0;

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

  // ── Category pie chart ───────────────────────────────────────────────────
  if (d.top_cats && d.top_cats.length) {
    const chartSection = document.createElement('div');
    chartSection.className = 'dash-section dash-chart-section';
    const chartHdr = document.createElement('div');
    chartHdr.className = 'dash-section-hdr';
    chartHdr.textContent = 'What you have packed';
    chartSection.appendChild(chartHdr);
    chartSection.appendChild(makeCategoryPieChart(d.top_cats));
    el.appendChild(chartSection);
  }

  // ── Summary stats (compact) ───────────────────────────────────────────────
  if (t.empty_boxes > 0 || t.unassigned_boxes > 0) {
    const warns = document.createElement('div');
    warns.className = 'dash-warns';
    if (t.empty_boxes > 0)
      warns.innerHTML += `<div class="dash-warn-item">⚠️ ${t.empty_boxes} empty box${t.empty_boxes!==1?'es':''}</div>`;
    if (t.unassigned_boxes > 0)
      warns.innerHTML += `<div class="dash-warn-item">⚠️ ${t.unassigned_boxes} box${t.unassigned_boxes!==1?'es':''} with no room</div>`;
    el.appendChild(warns);
  }

  // ── Quick actions — context-aware based on wizard phase ──────────────────
  const qa = document.createElement('div');
  qa.className = 'dash-actions';

  // Use wizard session passed in from loadDashboard
  if (wizSession && ctx) {
    const phase = wizSession.phase;
    const phaseLabel = phase === 'moving_day' ? 'Moving Day' : phase === 'settling' ? 'Settling In' : 'Packing';
    const phaseIcon  = phase === 'moving_day' ? '🚛' : phase === 'settling' ? '🏠' : '📦';
    const resumeBtn  = document.createElement('button');
    resumeBtn.className = 'dash-action-btn primary';
    resumeBtn.innerHTML = `<span>${phaseIcon}</span>Resume ${phaseLabel}`;
    resumeBtn.addEventListener('click', () => {
      if (phase === 'moving_day') openWizardPhase('moving_day');
      else if (phase === 'settling') openWizardPhase('settling');
      else showPanel('wizard');
    });
    qa.appendChild(resumeBtn);

    if (phase === 'packing') {
      const mdBtn = document.createElement('button');
      mdBtn.className = 'dash-action-btn';
      mdBtn.innerHTML = '<span>🚛</span>Moving Day';
      mdBtn.addEventListener('click', () => openWizardPhase('moving_day'));
      qa.appendChild(mdBtn);
    } else if (phase === 'moving_day') {
      const siBtn = document.createElement('button');
      siBtn.className = 'dash-action-btn';
      siBtn.innerHTML = '<span>🏠</span>Settling In';
      siBtn.addEventListener('click', () => openWizardPhase('settling'));
      qa.appendChild(siBtn);
    }
  } else {
    const packBtn = document.createElement('button');
    packBtn.className = 'dash-action-btn primary';
    packBtn.innerHTML = '<span>⚡</span>Start Packing';
    packBtn.addEventListener('click', openPackingMode);
    qa.appendChild(packBtn);
  }

  const addBtn = document.createElement('button');
  addBtn.className = 'dash-action-btn';
  addBtn.innerHTML = '<span>＋</span>Add Item';
  addBtn.addEventListener('click', openQuickAddItem);
  qa.appendChild(addBtn);

  const boxBtn = document.createElement('button');
  boxBtn.className = 'dash-action-btn';
  boxBtn.innerHTML = '<span>📦</span>View Boxes';
  boxBtn.addEventListener('click', () => showPanel('boxes'));
  qa.appendChild(boxBtn);

  const searchBtn = document.createElement('button');
  searchBtn.className = 'dash-action-btn';
  searchBtn.innerHTML = '<span>🔍</span>Find Something';
  searchBtn.addEventListener('click', () => { document.getElementById('globalSearch').focus(); showPanel('search'); });
  qa.appendChild(searchBtn);

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
