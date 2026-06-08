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
