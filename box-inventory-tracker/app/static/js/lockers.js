// ── Storage Locker Manager ────────────────────────────────────────────────────

let _editingLockerId = null;

async function loadLockersSettings() {
  const list = document.getElementById('lockers-list');
  if (!list) return;
  try {
    const lockers = await api('/api/lockers');
    renderLockersList(lockers);
    await populateLockerRoomSelect();
  } catch(e) {
    list.innerHTML = `<div style="color:#c33;font-size:13px;">Could not load lockers: ${esc(e.message)}</div>`;
  }
}

function renderLockersList(lockers) {
  const list = document.getElementById('lockers-list');
  if (!list) return;
  if (!lockers.length) {
    list.innerHTML = '<div style="color:var(--muted);font-size:13px;font-style:italic;">No storage lockers added yet.</div>';
    return;
  }
  list.innerHTML = '';
  lockers.forEach(l => {
    const card = document.createElement('div');
    card.className = 'locker-card';

    const sqft = l.size_width_ft && l.size_depth_ft
      ? ` · ${l.size_width_ft}×${l.size_depth_ft}ft (${(l.size_width_ft * l.size_depth_ft).toFixed(0)} sq ft)`
      : '';
    const costStr = l.monthly_cost
      ? ` · ${l.currency || 'CAD'} ${parseFloat(l.monthly_cost).toFixed(2)}/mo` : '';
    const annualStr = l.monthly_cost
      ? ` (${l.currency || 'CAD'} ${(parseFloat(l.monthly_cost) * 12).toFixed(0)}/yr)` : '';

    card.innerHTML = `
      <div class="locker-card-main">
        <div class="locker-card-name">🏚️ ${esc(l.name)}</div>
        <div class="locker-card-meta">
          ${l.provider ? `<span>${esc(l.provider)}</span>` : ''}
          ${l.unit_number ? `<span>Unit ${esc(l.unit_number)}</span>` : ''}
          ${sqft ? `<span>${sqft.replace(' · ', '')}</span>` : ''}
        </div>
        <div class="locker-card-cost">
          ${costStr ? `<span class="locker-cost-badge">${costStr.replace(' · ', '')}</span>` : ''}
          ${annualStr ? `<span style="color:var(--muted);font-size:11px;">${annualStr}</span>` : ''}
        </div>
        <div class="locker-card-chips">
          ${l.climate_controlled ? '<span class="locker-chip">❄️ Climate controlled</span>' : ''}
          ${l.box_count > 0 ? `<span class="locker-chip">${l.box_count} boxes</span>` : ''}
          ${l.item_count > 0 ? `<span class="locker-chip">${l.item_count} items</span>` : ''}
          ${l.room_name ? `<span class="locker-chip">📍 ${esc(l.room_name)}</span>` : ''}
          ${l.contract_end ? `<span class="locker-chip ${isExpiringSoon(l.contract_end) ? 'expiring' : ''}">
            ${isExpiringSoon(l.contract_end) ? '⚠️ ' : ''}Ends ${l.contract_end}</span>` : ''}
        </div>
        ${l.access_hours ? `<div style="font-size:12px;color:var(--muted);margin-top:3px;">🕐 ${esc(l.access_hours)}</div>` : ''}
        ${l.gate_code ? `<div style="font-size:12px;color:var(--muted);">🔑 Gate: ${esc(l.gate_code)}</div>` : ''}
        ${l.notes ? `<div style="font-size:12px;color:var(--muted);font-style:italic;margin-top:3px;">${esc(l.notes)}</div>` : ''}
      </div>
      <div class="locker-card-actions">
        <button class="btn-icon" onclick="openLockerModal(${l.id})" title="Edit">✏️</button>
        <button class="btn-icon danger" onclick="deleteLocker(${l.id}, '${esc(l.name)}')" title="Delete">🗑</button>
      </div>`;
    list.appendChild(card);
  });
}

function isExpiringSoon(dateStr) {
  if (!dateStr) return false;
  const end = new Date(dateStr);
  const days = (end - new Date()) / 86400000;
  return days < 45;
}

async function openLockerModal(id) {
  _editingLockerId = id || null;
  document.getElementById('locker-modal-title').textContent = id ? 'Edit Storage Locker' : 'Add Storage Locker';
  document.getElementById('locker-editing-id').value = id || '';

  // Clear form
  ['locker-name','locker-provider','locker-unit','locker-address',
   'locker-width','locker-depth','locker-height',
   'locker-cost','locker-start','locker-end','locker-access',
   'locker-gate','locker-lock','locker-notes','locker-insurance-cost']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('locker-climate').checked = false;
  document.getElementById('locker-insurance').checked = false;
  document.getElementById('locker-currency').value = 'CAD';
  document.getElementById('locker-ins-wrap').style.display = 'none';
  document.getElementById('locker-size-preview').textContent = '—';
  document.getElementById('locker-cost-preview').textContent = '';

  await populateLockerRoomSelect();

  if (id) {
    try {
      const l = await api(`/api/lockers/${id}`);
      document.getElementById('locker-name').value = l.name || '';
      document.getElementById('locker-provider').value = l.provider || '';
      document.getElementById('locker-unit').value = l.unit_number || '';
      document.getElementById('locker-address').value = l.address || '';
      document.getElementById('locker-width').value = l.size_width_ft || '';
      document.getElementById('locker-depth').value = l.size_depth_ft || '';
      document.getElementById('locker-height').value = l.size_height_ft || '';
      document.getElementById('locker-cost').value = l.monthly_cost || '';
      document.getElementById('locker-currency').value = l.currency || 'CAD';
      document.getElementById('locker-start').value = l.contract_start || '';
      document.getElementById('locker-end').value = l.contract_end || '';
      document.getElementById('locker-access').value = l.access_hours || '';
      document.getElementById('locker-gate').value = l.gate_code || '';
      document.getElementById('locker-lock').value = l.lock_type || '';
      document.getElementById('locker-notes').value = l.notes || '';
      document.getElementById('locker-climate').checked = !!l.climate_controlled;
      document.getElementById('locker-insurance').checked = !!l.insurance_included;
      document.getElementById('locker-insurance-cost').value = l.insurance_monthly || '';
      document.getElementById('locker-room').value = l.room_id || '';
      if (l.insurance_included) document.getElementById('locker-ins-wrap').style.display = '';
      updateLockerSizePreview();
      updateLockerCostPreview();
    } catch(e) { toast('Could not load locker: ' + e.message, true); }
  }

  openModal('modal-locker');
}

async function populateLockerRoomSelect() {
  const sel = document.getElementById('locker-room');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">— No room linked —</option>';
  try {
    const rooms = await api('/api/rooms');
    rooms.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.id; opt.textContent = r.name;
      if (String(r.id) === String(current)) opt.selected = true;
      sel.appendChild(opt);
    });
  } catch(e) {}
}

function updateLockerSizePreview() {
  const w = parseFloat(document.getElementById('locker-width')?.value);
  const d = parseFloat(document.getElementById('locker-depth')?.value);
  const h = parseFloat(document.getElementById('locker-height')?.value);
  const el = document.getElementById('locker-size-preview');
  if (!el) return;
  if (w && d) {
    const sqft = (w * d).toFixed(0);
    const cuft = h ? (w * d * h).toFixed(0) : null;
    el.textContent = `${w}×${d}ft = ${sqft} sq ft${cuft ? ` · ${cuft} cu ft` : ''}`;
  } else {
    el.textContent = '—';
  }
}

function updateLockerCostPreview() {
  const cost     = parseFloat(document.getElementById('locker-cost')?.value) || 0;
  const ins      = parseFloat(document.getElementById('locker-insurance-cost')?.value) || 0;
  const currency = document.getElementById('locker-currency')?.value || 'CAD';
  const el       = document.getElementById('locker-cost-preview');
  if (!el || !cost) { if (el) el.textContent = ''; return; }
  const total   = cost + ins;
  const annual  = (total * 12).toFixed(2);
  el.textContent = `Total: ${currency} ${total.toFixed(2)}/mo · ${currency} ${annual}/yr`;
}

function toggleInsuranceCost() {
  const checked = document.getElementById('locker-insurance')?.checked;
  document.getElementById('locker-ins-wrap').style.display = checked ? '' : 'none';
  if (!checked) document.getElementById('locker-insurance-cost').value = '';
  updateLockerCostPreview();
}

async function saveLocker() {
  const name = document.getElementById('locker-name').value.trim();
  if (!name) { toast('Locker name is required', true); return; }

  const g = id => document.getElementById(id)?.value?.trim() || null;
  const n = id => { const v = document.getElementById(id)?.value; return v ? parseFloat(v) : null; };

  const payload = {
    name,
    provider:           g('locker-provider'),
    address:            g('locker-address'),
    unit_number:        g('locker-unit'),
    size_width_ft:      n('locker-width'),
    size_depth_ft:      n('locker-depth'),
    size_height_ft:     n('locker-height'),
    monthly_cost:       n('locker-cost'),
    currency:           g('locker-currency') || 'CAD',
    contract_start:     g('locker-start'),
    contract_end:       g('locker-end'),
    access_hours:       g('locker-access'),
    gate_code:          g('locker-gate'),
    lock_type:          g('locker-lock'),
    notes:              g('locker-notes'),
    climate_controlled: document.getElementById('locker-climate')?.checked ? 1 : 0,
    insurance_included: document.getElementById('locker-insurance')?.checked ? 1 : 0,
    insurance_monthly:  n('locker-insurance-cost'),
    room_id:            g('locker-room') ? parseInt(g('locker-room')) : null,
  };

  try {
    if (_editingLockerId) {
      await api(`/api/lockers/${_editingLockerId}`, { method: 'PUT', body: JSON.stringify(payload) });
      toast('Locker updated');
    } else {
      await api('/api/lockers', { method: 'POST', body: JSON.stringify(payload) });
      toast('Locker added');
    }
    closeModal('modal-locker');
    loadLockersSettings();
  } catch(e) {
    toast('Save failed: ' + e.message, true);
  }
}

async function deleteLocker(id, name) {
  if (!confirm(`Delete locker "${name}"?\n\nThis only removes the locker record — boxes and rooms are not affected.`)) return;
  try {
    await api(`/api/lockers/${id}`, { method: 'DELETE' });
    toast('Locker deleted');
    loadLockersSettings();
  } catch(e) {
    toast('Delete failed: ' + e.message, true);
  }
}
