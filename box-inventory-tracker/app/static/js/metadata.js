// ── Item Metadata & Credit Cards ──────────────────────────────────────────
let creditCards = [];

async function loadCreditCards() {
  try { creditCards = await api('/api/credit-cards'); }
  catch(e) { creditCards = []; }
}

// ── Metadata modal ─────────────────────────────────────────────────────────
let metadataItemId = null;

async function openMetadataModal(itemId, itemName) {
  // Open the standard item modal, pre-populated with this item, metadata section expanded
  if (!creditCards.length) await loadCreditCards();
  // Fake the item into allItems if not present (e.g. called from box detail)
  let item = allItems.find(i => i.id === itemId);
  if (!item) {
    try { item = await api(`/api/items/${itemId}`); } catch(e) {}
  }
  openItemModal(itemId);
  // Force the metadata section open
  setTimeout(() => {
    const section = document.getElementById('item-meta-section');
    const chevron = document.getElementById('item-meta-chevron');
    if (section) section.style.display = 'block';
    if (chevron) chevron.style.transform = 'rotate(90deg)';
  }, 50);
}

function clearMetadataForm() {
  ['metadata-serial','metadata-model','metadata-purchase-date',
   'metadata-price','metadata-store','metadata-warranty-value',
   'metadata-notes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const unitEl = document.getElementById('metadata-warranty-unit');
  if (unitEl) unitEl.value = 'years';
  document.getElementById('metadata-card-select').value = '';
  updateMetaWarrantyPreview();
}

function fillMetadataForm(meta) {
  const set = (id, val) => { const el = document.getElementById(id); if (el && val != null) el.value = val; };
  set('metadata-serial',          meta.serial_number || '');
  set('metadata-model',           meta.model_number || '');
  set('metadata-purchase-date',   meta.purchase_date || '');
  set('metadata-price',           meta.purchase_price != null ? meta.purchase_price : '');
  set('metadata-store',           meta.purchase_store || '');
  set('metadata-warranty-value',  meta.warranty_value || '');
  set('metadata-warranty-unit',   meta.warranty_unit || 'years');
  set('metadata-card-select',     meta.credit_card_id || '');
  set('metadata-notes',           meta.notes || '');
  updateMetaWarrantyPreview();
}

function populateMetaCardSelect(selectedId) {
  const sel = document.getElementById('metadata-card-select');
  if (!sel) return;
  const prev = selectedId != null ? selectedId : sel.value;
  sel.innerHTML = '<option value="">— No card used —</option>';
  creditCards.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    const desc = c.extension_type === 'double'
      ? `doubles warranty${c.extension_cap_months ? `, max ${c.extension_cap_months} mo total` : ''}`
      : `+${c.extension_value} ${c.extension_unit}`;
    opt.textContent = `${c.name} (${desc})`;
    if (String(c.id) === String(prev)) opt.selected = true;
    sel.appendChild(opt);
  });
}

function updateMetaWarrantyPreview() {
  const preview = document.getElementById('metadata-warranty-preview');
  if (!preview) return;

  const purchaseDate    = document.getElementById('metadata-purchase-date')?.value;
  const warrantyValue   = parseInt(document.getElementById('metadata-warranty-value')?.value);
  const warrantyUnit    = document.getElementById('metadata-warranty-unit')?.value || 'years';
  const cardId          = document.getElementById('metadata-card-select')?.value;

  if (!purchaseDate || !warrantyValue) { preview.textContent = ''; return; }

  // Calculate in JS (mirrors server logic)
  const purchase = new Date(purchaseDate + 'T00:00:00');
  const mfrExpiry = addDuration(purchase, warrantyValue, warrantyUnit);
  const card = creditCards.find(c => String(c.id) === String(cardId));

  let effectiveExpiry = mfrExpiry;
  if (card) {
    if (card.extension_type === 'double') {
      effectiveExpiry = addDuration(mfrExpiry, warrantyValue, warrantyUnit);
    } else {
      effectiveExpiry = addDuration(mfrExpiry, card.extension_value, card.extension_unit);
    }
    if (card.extension_cap_months) {
      const cap = addDuration(purchase, card.extension_cap_months, 'months');
      if (effectiveExpiry > cap) effectiveExpiry = cap;
    }
  }

  const mfrStr = mfrExpiry.toISOString().slice(0, 10);
  const effStr = effectiveExpiry.toISOString().slice(0, 10);
  const today = new Date();
  const daysLeft = Math.ceil((effectiveExpiry - today) / 86400000);
  const color = daysLeft < 0 ? '#c33' : daysLeft < 90 ? '#f90' : 'var(--accent)';

  if (card) {
    preview.innerHTML = `
      <span style="color:var(--muted);">Manufacturer expires: ${mfrStr}</span><br>
      <span style="color:${color};font-weight:700;">
        Effective with ${esc(card.name)}: ${effStr}${daysLeft < 0 ? ' (expired)' : ''}
      </span>`;
  } else {
    preview.innerHTML = `<span style="color:${color};font-weight:700;">
      Expires: ${mfrStr}${daysLeft < 0 ? ' (expired)' : ''}
    </span>`;
  }
}

function addDuration(date, value, unit) {
  const d = new Date(date);
  if (unit === 'days')   { d.setDate(d.getDate() + value); }
  else if (unit === 'months') {
    const m = d.getMonth() + value;
    d.setFullYear(d.getFullYear() + Math.floor(m / 12));
    d.setMonth(((m % 12) + 12) % 12);
  }
  else if (unit === 'years') { d.setFullYear(d.getFullYear() + value); }
  return d;
}

async function saveMetadata() {
  if (!metadataItemId) return;
  const get = id => document.getElementById(id)?.value?.trim() || null;
  const payload = {
    serial_number:   get('metadata-serial'),
    model_number:    get('metadata-model'),
    purchase_date:   get('metadata-purchase-date') || null,
    purchase_price:  get('metadata-price') ? parseFloat(get('metadata-price')) : null,
    purchase_store:  get('metadata-store'),
    warranty_value:  get('metadata-warranty-value') ? parseInt(get('metadata-warranty-value')) : null,
    warranty_unit:   get('metadata-warranty-unit') || 'years',
    credit_card_id:  get('metadata-card-select') ? parseInt(get('metadata-card-select')) : null,
    notes:           get('metadata-notes'),
  };
  try {
    await api(`/api/items/${metadataItemId}/metadata`, { method: 'PUT', body: JSON.stringify(payload) });
    closeModal('modal-metadata');
    toast('Asset details saved');
  } catch(e) { toast(`Save failed: ${e.message}`, true); }
}

// ── Credit card management (Settings page) ────────────────────────────────
let editingCardId = null;

async function loadCreditCardsSettings() {
  await loadCreditCards();
  renderCreditCardsSettings();
}

function renderCreditCardsSettings() {
  const list = document.getElementById('cc-list');
  if (!list) return;
  list.innerHTML = '';
  if (!creditCards.length) {
    list.innerHTML = '<div style="color:var(--muted);font-size:13px;">No cards added yet.</div>';
    return;
  }
  creditCards.forEach(c => {
    const desc = c.extension_type === 'double'
      ? `Doubles manufacturer warranty${c.extension_cap_months ? `, capped at ${c.extension_cap_months} months total` : ''}`
      : `Adds ${c.extension_value} ${c.extension_unit}`;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:flex-start;gap:10px;padding:10px 0;' +
      'border-bottom:1px solid var(--border);';
    row.innerHTML = `
      <div style="flex:1;">
        <div style="font-weight:700;font-size:14px;">${esc(c.name)}</div>
        <div style="color:var(--muted);font-size:12px;font-family:var(--mono);">
          ${esc(desc)}
        </div>
        ${c.notes ? `<div style="color:var(--muted);font-size:12px;">${esc(c.notes)}</div>` : ''}
      </div>
      <button class="btn btn-secondary btn-sm" onclick="openCreditCardModal(${c.id})">Edit</button>
      <button class="btn btn-secondary btn-sm" style="color:#c33;"
        onclick="deleteCreditCard(${c.id})">Delete</button>
    `;
    list.appendChild(row);
  });
}

function openCreditCardModal(id = null) {
  editingCardId = id;
  const card = id ? creditCards.find(c => c.id === id) : null;
  document.getElementById('cc-modal-title').textContent = id ? 'Edit Card' : 'Add Card';
  document.getElementById('cc-name').value       = card?.name || '';
  document.getElementById('cc-ext-type').value   = card?.extension_type || 'add';
  document.getElementById('cc-ext-value').value  = card?.extension_value ?? 1;
  document.getElementById('cc-ext-unit').value   = card?.extension_unit || 'years';
  document.getElementById('cc-cap').value        = card?.extension_cap_months || '';
  document.getElementById('cc-notes').value      = card?.notes || '';
  toggleCCCapField();
  openModal('modal-credit-card');
}

function toggleCCCapField() {
  const type = document.getElementById('cc-ext-type').value;
  const capRow = document.getElementById('cc-cap-row');
  if (capRow) capRow.style.display = type === 'double' ? 'block' : 'none';
}

async function saveCreditCard() {
  const name      = document.getElementById('cc-name').value.trim();
  const extType   = document.getElementById('cc-ext-type').value;
  const extValue  = parseInt(document.getElementById('cc-ext-value').value) || 1;
  const extUnit   = document.getElementById('cc-ext-unit').value;
  const cap       = document.getElementById('cc-cap').value;
  const notes     = document.getElementById('cc-notes').value.trim() || null;
  if (!name) { toast('Card name required', true); return; }
  const payload = {
    name, extension_type: extType, extension_value: extValue,
    extension_unit: extUnit,
    extension_cap_months: extType === 'double' && cap ? parseInt(cap) : null,
    notes,
  };
  try {
    if (editingCardId) {
      await api(`/api/credit-cards/${editingCardId}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await api('/api/credit-cards', { method: 'POST', body: JSON.stringify(payload) });
    }
    closeModal('modal-credit-card');
    toast(editingCardId ? 'Card updated' : 'Card added');
    await loadCreditCardsSettings();
  } catch(e) { toast(`Failed: ${e.message}`, true); }
}

async function deleteCreditCard(id) {
  const card = creditCards.find(c => c.id === id);
  if (!confirm(`Delete "${card?.name}"?`)) return;
  try {
    await api(`/api/credit-cards/${id}`, { method: 'DELETE' });
    toast('Card deleted');
    await loadCreditCardsSettings();
  } catch(e) { toast(`Failed: ${e.message}`, true); }
}
