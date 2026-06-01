// ── Items ──────────────────────────────────────────────────────────────────

// ── Items state ──────────────────────────────────────────────────────────────
let itemSort = 'name';      // 'name' | 'category'
let itemSortDir = 1;        // 1=asc, -1=desc
let itemCatFilter = null;   // category name string or null
let expandedItemId = null;

async function loadItems() {
  allItems = await api('/api/items');
  applyItemFilters();
}

async function refreshItemsInPlace() {
  // Remember which item row is currently expanded
  const openExpandTr = [...document.querySelectorAll('.item-expand-row')]
    .find(r => r.style.display !== 'none');
  const openItemId = openExpandTr ? openExpandTr.id.replace('item-expand-', '') : null;

  allItems = await api('/api/items');
  applyItemFilters();

  // Re-expand the same item after re-render
  if (openItemId) {
    const mainTr = document.querySelector(`.item-main-row[data-item-id="${openItemId}"]`);
    if (mainTr) toggleItemExpand(parseInt(openItemId), mainTr);
  }
}

function setItemSort(field) {
  if (itemSort === field) {
    itemSortDir *= -1;
  } else {
    itemSort = field;
    itemSortDir = 1;
  }
  // Update header icons
  document.getElementById('sort-name-icon').textContent = '↕';
  document.getElementById('sort-cat-icon').textContent = '↕';
  const icon = itemSort === 'name' ? 'sort-name-icon' : 'sort-cat-icon';
  document.getElementById(icon).textContent = itemSortDir === 1 ? '↑' : '↓';
  document.getElementById(icon).classList.add('sort-active');
  applyItemFilters();
}

function toggleCatFilterDropdown(e) {
  e.stopPropagation();
  const dd = document.getElementById('cat-filter-dropdown');
  const btn = document.getElementById('cat-filter-btn');
  const isOpen = dd.style.display !== 'none';
  if (isOpen) { dd.style.display = 'none'; return; }
  // Position using fixed coords so it escapes overflow:hidden on tbl-wrap
  const rect = btn.getBoundingClientRect();
  dd.style.top = (rect.bottom + 2) + 'px';
  dd.style.left = rect.left + 'px';

  // Build category list from allItems (distinct, sorted)
  const cats = [...new Set(allItems.map(i => i.category).filter(Boolean))].sort();
  dd.innerHTML = '';

  // "(all)" option
  const allOpt = document.createElement('div');
  allOpt.className = 'cat-filter-option all-opt' + (itemCatFilter === null ? ' selected' : '');
  allOpt.textContent = '(all categories)';
  allOpt.addEventListener('mousedown', e => e.preventDefault());
  allOpt.addEventListener('click', () => {
    setItemCatFilter(null);
    dd.style.display = 'none';
  });
  dd.appendChild(allOpt);

  cats.forEach(cat => {
    const opt = document.createElement('div');
    opt.className = 'cat-filter-option' + (cat === itemCatFilter ? ' selected' : '');
    opt.textContent = cat;
    opt.addEventListener('mousedown', e => e.preventDefault());
    opt.addEventListener('click', () => {
      setItemCatFilter(cat);
      dd.style.display = 'none';
    });
    dd.appendChild(opt);
  });

  dd.style.display = 'block';
}

// Close cat filter dropdown on outside click
document.addEventListener('click', e => {
  if (!e.target.closest('#cat-filter-btn') && !e.target.closest('#cat-filter-dropdown')) {
    const dd = document.getElementById('cat-filter-dropdown');
    if (dd) dd.style.display = 'none';
  }
});

function setItemCatFilter(catName) {
  itemCatFilter = catName;
  const badge = document.getElementById('item-cat-filter-badge');
  const btn = document.getElementById('cat-filter-btn');
  if (catName) {
    document.getElementById('item-cat-filter-label').textContent = '🏷️ ' + catName;
    badge.style.display = 'flex';
    if (btn) { btn.style.color = 'var(--accent2)'; btn.style.borderColor = 'var(--accent2)'; }
  } else {
    badge.style.display = 'none';
    if (btn) { btn.style.color = ''; btn.style.borderColor = ''; }
  }
  applyItemFilters();
}

function clearItemCatFilter() { setItemCatFilter(null); }

function applyItemFilters() {
  const q = (document.getElementById('itemSearch').value || '').toLowerCase().trim();
  let items = allItems.slice();
  // Text filter
  if (q) items = items.filter(i =>
    i.name.toLowerCase().includes(q) || (i.category||'').toLowerCase().includes(q)
  );
  // Category filter
  if (itemCatFilter) items = items.filter(i => (i.category||'') === itemCatFilter);
  // Sort
  items.sort((a, b) => {
    const av = (itemSort === 'name' ? a.name : (a.category||'zzz')).toLowerCase();
    const bv = (itemSort === 'name' ? b.name : (b.category||'zzz')).toLowerCase();
    return av < bv ? -itemSortDir : av > bv ? itemSortDir : 0;
  });
  renderItems(items);
}

function renderItems(items) {
  const tbody = document.getElementById('items-tbody');
  tbody.innerHTML = '';
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">No items yet.</td></tr>';
    return;
  }
  items.forEach(i => {
    // Main row
    const tr = document.createElement('tr');
    tr.className = 'item-main-row';
    tr.dataset.itemId = i.id;

    const nameCell = document.createElement('td');
    nameCell.textContent = i.name;

    const catCell = document.createElement('td');
    if (i.category) {
      const chip = document.createElement('span');
      chip.className = 'chip cat';
      chip.style.cursor = 'pointer';
      chip.title = 'Filter by this category';
      chip.textContent = i.category;
      chip.addEventListener('click', e => {
        e.stopPropagation();
        setItemCatFilter(itemCatFilter === i.category ? null : i.category);
      });
      catCell.appendChild(chip);
    } else {
      catCell.innerHTML = '<span style="color:var(--muted)">—</span>';
    }

    const boxCell = document.createElement('td');
    boxCell.style.cssText = 'font-family:var(--mono);font-size:12px;';
    if (i.in_boxes) {
      i.in_boxes.split(',').forEach(n => {
        const b = document.createElement('span');
        b.className = 'badge';
        b.textContent = '#' + n;
        boxCell.appendChild(b);
      });
    } else {
      boxCell.innerHTML = '<span style="color:var(--muted)">—</span>';
    }

    const actCell = document.createElement('td');
    actCell.style.whiteSpace = 'nowrap';
    const editBtn = document.createElement('button');
    editBtn.className = 'btn-icon'; editBtn.textContent = '✏️';
    editBtn.addEventListener('click', e => { e.stopPropagation(); openItemModal(i.id); });
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-icon danger'; delBtn.textContent = '🗑';
    delBtn.addEventListener('click', e => { e.stopPropagation(); deleteItem(i.id); });
    actCell.appendChild(editBtn); actCell.appendChild(delBtn);

    tr.appendChild(nameCell); tr.appendChild(catCell);
    tr.appendChild(boxCell); tr.appendChild(actCell);

    // Click row to expand
    tr.addEventListener('click', () => toggleItemExpand(i.id, tr));

    tbody.appendChild(tr);

    // Expand row (hidden by default)
    const expandTr = document.createElement('tr');
    expandTr.className = 'item-expand-row';
    expandTr.id = `item-expand-${i.id}`;
    expandTr.style.display = 'none';
    const expandTd = document.createElement('td');
    expandTd.colSpan = 4;
    const inner = document.createElement('div');
    inner.className = 'expand-inner';
    inner.innerHTML = '<span style="color:var(--muted);font-family:var(--mono);font-size:12px;">Loading…</span>';
    expandTd.appendChild(inner);
    expandTr.appendChild(expandTd);
    tbody.appendChild(expandTr);
  });
}

async function toggleItemExpand(itemId, mainTr) {
  const expandTr = document.getElementById(`item-expand-${itemId}`);
  const isOpen = expandTr.style.display !== 'none';
  // Close all open rows first
  document.querySelectorAll('.item-expand-row').forEach(r => r.style.display = 'none');
  document.querySelectorAll('.item-main-row').forEach(r => r.classList.remove('expanded'));

  if (isOpen) return; // was open, just close

  mainTr.classList.add('expanded');
  expandTr.style.display = '';
  const inner = expandTr.querySelector('.expand-inner');

  try {
    const item = await api(`/api/items/${itemId}`);
    if (!item.boxes || !item.boxes.length) {
      inner.innerHTML = '<span style="color:var(--muted);font-family:var(--mono);font-size:12px;">Not in any box.</span>';
      return;
    }
    inner.innerHTML = '';
    item.boxes.forEach(b => {
      const row = document.createElement('div');
      row.className = 'expand-box-row';
      row.dataset.boxItemId = b.box_item_id;
      row.dataset.itemName = item.name;
      row.dataset.boxId = b.box_id;
      row.innerHTML = `
        <span class="expand-box-num" style="cursor:pointer;" title="Go to box">BOX ${b.box_number}</span>
        <span class="expand-box-label">${esc(b.label || 'Unlabelled')}</span>
        <span class="expand-box-meta">
          ${b.room_name ? `📍 ${esc(b.room_name)}` : 'No room'}
          · qty: <strong style="color:var(--accent)">${b.quantity}</strong>
          ${b.notes ? `· ${esc(b.notes)}` : ''}
        </span>`;

      // Navigate on clicking the box number badge
      row.querySelector('.expand-box-num').addEventListener('click', e => {
        e.stopPropagation(); openBoxDetail(b.box_id);
      });

      // Move button
      const moveBtn = document.createElement('button');
      moveBtn.className = 'btn-move';
      moveBtn.title = 'Move to another box';
      moveBtn.textContent = '⇄';
      moveBtn.style.marginLeft = 'auto';
      moveBtn.addEventListener('click', e => {
        e.stopPropagation();
        moveItemSourceBoxId = b.box_id;
        openMoveItemModal(b.box_item_id, item.name, b.box_id, b.quantity);
      });
      row.appendChild(moveBtn);

      inner.appendChild(row);
    });
  } catch(e) {
    inner.innerHTML = `<span style="color:var(--danger)">Error: ${esc(e.message)}</span>`;
  }
}

function openItemModal(id = null) {
  editingItem = id;
  document.getElementById('modal-item-title').textContent = id ? 'Edit Item' : 'Add Item';
  const item = id ? allItems.find(x => x.id === id) : null;
  document.getElementById('item-name').value = item ? item.name : '';
  document.getElementById('item-category').value = item ? (item.category||'') : '';
  document.getElementById('item-upc').value = item ? (item.upc||'') : '';
  document.getElementById('cat-suggestions').classList.remove('open');

  openModal('modal-item');
}

function toggleItemMetaSection() {
  const section = document.getElementById('item-meta-section');
  const chevron = document.getElementById('item-meta-chevron');
  const open = section.style.display !== 'none';
  section.style.display = open ? 'none' : 'block';
  chevron.style.transform = open ? '' : 'rotate(90deg)';
}

function collapseItemMetaSection() {
  const section = document.getElementById('item-meta-section');
  const chevron = document.getElementById('item-meta-chevron');
  if (section) { section.style.display = 'none'; }
  if (chevron) { chevron.style.transform = ''; }
}

function clearItemMetaForm() {
  ['item-meta-serial','item-meta-model','item-meta-purchase-date',
   'item-meta-price','item-meta-store','item-meta-warranty-value',
   'item-meta-notes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const u = document.getElementById('item-meta-warranty-unit');
  if (u) u.value = 'years';
  const c = document.getElementById('item-meta-card-select');
  if (c) c.value = '';
  const p = document.getElementById('item-meta-warranty-preview');
  if (p) p.textContent = '';
}

function fillItemMetaForm(meta) {
  const set = (id, val) => { const el = document.getElementById(id); if (el && val != null) el.value = val; };
  set('item-meta-serial',          meta.serial_number || '');
  set('item-meta-model',           meta.model_number || '');
  set('item-meta-purchase-date',   meta.purchase_date || '');
  set('item-meta-price',           meta.purchase_price != null ? meta.purchase_price : '');
  set('item-meta-store',           meta.purchase_store || '');
  set('item-meta-warranty-value',  meta.warranty_value || '');
  set('item-meta-warranty-unit',   meta.warranty_unit || 'years');
  set('item-meta-card-select',     meta.credit_card_id || '');
  set('item-meta-notes',           meta.notes || '');
  // Auto-expand if any metadata exists
  if (meta.serial_number || meta.purchase_date || meta.warranty_value) {
    const section = document.getElementById('item-meta-section');
    const chevron = document.getElementById('item-meta-chevron');
    if (section) section.style.display = 'block';
    if (chevron) chevron.style.transform = 'rotate(90deg)';
  }
  updateItemMetaWarrantyPreview();
}

function populateItemMetaCardSelect() {
  const sel = document.getElementById('item-meta-card-select');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">— No card used —</option>';
  (creditCards || []).forEach(c => {
    const desc = c.extension_type === 'double'
      ? `doubles warranty${c.extension_cap_months ? `, max ${c.extension_cap_months} mo total` : ''}`
      : `+${c.extension_value} ${c.extension_unit}`;
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.name} (${desc})`;
    if (String(c.id) === String(prev)) opt.selected = true;
    sel.appendChild(opt);
  });
}

function updateItemMetaWarrantyPreview() {
  const preview = document.getElementById('item-meta-warranty-preview');
  if (!preview) return;
  const purchaseDate  = document.getElementById('item-meta-purchase-date')?.value;
  const wValue        = parseInt(document.getElementById('item-meta-warranty-value')?.value);
  const wUnit         = document.getElementById('item-meta-warranty-unit')?.value || 'years';
  const cardId        = document.getElementById('item-meta-card-select')?.value;
  if (!purchaseDate || !wValue) { preview.textContent = ''; return; }
  // Reuse addDuration from metadata.js
  const purchase = new Date(purchaseDate + 'T00:00:00');
  const mfrExpiry = addDuration(purchase, wValue, wUnit);
  const card = (creditCards || []).find(c => String(c.id) === String(cardId));
  let effectiveExpiry = mfrExpiry;
  if (card) {
    if (card.extension_type === 'double') {
      effectiveExpiry = addDuration(mfrExpiry, wValue, wUnit);
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
  const daysLeft = Math.ceil((effectiveExpiry - new Date()) / 86400000);
  const color = daysLeft < 0 ? '#c33' : daysLeft < 90 ? '#f90' : 'var(--accent)';
  preview.innerHTML = card
    ? `<span style="color:var(--muted)">Manufacturer expires: ${mfrStr}</span><br>` +
      `<span style="color:${color};font-weight:700;">Effective with ${esc(card.name)}: ${effStr}${daysLeft < 0 ? ' (expired)' : ''}</span>`
    : `<span style="color:${color};font-weight:700;">Expires: ${mfrStr}${daysLeft < 0 ? ' (expired)' : ''}</span>`;
}

async function saveItem() {
  const name     = document.getElementById('item-name').value.trim();
  const category = document.getElementById('item-category').value.trim();
  const upc      = document.getElementById('item-upc').value.trim() || null;
  if (!name) { toast('Item name required', true); return; }
  try {
    if (editingItem) {
      await api(`/api/items/${editingItem}`, { method:'PUT', body:JSON.stringify({name, category, upc}) });
    } else {
      await api('/api/items', { method:'POST', body:JSON.stringify({name, category, upc}) });
    }
    closeModal('modal-item');
    toast(editingItem ? 'Item updated' : 'Item added');
    await loadItems();
  } catch(e) { toast(e.message, true); }
}

async function deleteItem(id) {
  if (!confirm('Delete this item? It will be removed from all boxes.')) return;
  await api(`/api/items/${id}`, { method:'DELETE' });
  toast('Item deleted');
  await loadItems();
}
