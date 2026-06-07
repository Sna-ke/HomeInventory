// ── Settings panel ────────────────────────────────────────────────────────

let _importData = null;

// Set household JSON download link once DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const link = document.getElementById('household-json-link');
  if (link) link.href = API_BASE + '/static/household_items.json';
  const link2 = document.getElementById('household-json-2-link');
  if (link2) link2.href = API_BASE + '/static/household_items_2.json';
});

// ── Import ────────────────────────────────────────────────────────────────

async function importPreview(input) {
  const preview = document.getElementById('import-preview');
  const runBtn  = document.getElementById('import-run-btn');
  const result  = document.getElementById('import-result');
  _importData = null;
  runBtn.style.display = 'none';
  result.innerHTML = '';
  preview.style.display = 'none';

  if (!input.files.length) return;
  try {
    _importData = JSON.parse(await input.files[0].text());
  } catch(e) {
    preview.style.display = 'block';
    preview.innerHTML = `<span style="color:#c33">❌ Invalid JSON: ${esc(e.message)}</span>`;
    return;
  }

  try {
    const res = await api('/api/import/preview', {
      method: 'POST', body: JSON.stringify(_importData),
    });
    preview.style.display = 'block';
    if (res.error_count > 0) {
      preview.innerHTML =
        `<div style="color:#c33;margin-bottom:6px;">⚠ ${res.error_count} validation error${res.error_count !== 1 ? 's' : ''}</div>` +
        res.errors.map(e => `<div style="color:var(--muted)">• ${esc(e)}</div>`).join('') +
        (res.error_count > res.errors.length ? `<div style="color:var(--muted)">…and ${res.error_count - res.errors.length} more</div>` : '');
    } else {
      const lines = [
        `<div style="color:var(--accent);margin-bottom:6px;">✓ File looks good</div>`,
        res.categories ? `<div>📂 Categories: <strong>${res.categories}</strong></div>` : '',
        res.rooms      ? `<div>🏠 Rooms: <strong>${res.rooms}</strong></div>` : '',
        res.items      ? `<div>📋 Items: <strong>${res.items}</strong></div>` : '',
        res.boxes      ? `<div>📦 Boxes: <strong>${res.boxes}</strong></div>` : '',
        res.box_contents ? `<div style="color:var(--muted);">   └ ${res.box_contents} box-item entries</div>` : '',
      ];
      preview.innerHTML = lines.filter(Boolean).join('');
      runBtn.style.display = '';
    }
  } catch(e) {
    preview.style.display = 'block';
    preview.innerHTML = `<span style="color:#c33">❌ Preview failed: ${esc(e.message)}</span>`;
  }
}

async function importRun() {
  if (!_importData) { toast('No file loaded', true); return; }
  const runBtn = document.getElementById('import-run-btn');
  const result = document.getElementById('import-result');
  runBtn.disabled = true;
  runBtn.textContent = '⟳ Importing…';
  result.innerHTML = '';

  try {
    const skip = document.getElementById('import-skip-existing').checked;
    const res = await api('/api/import/run', {
      method: 'POST', body: JSON.stringify({ ..._importData, skip_existing: skip }),
    });
    const lines = [
      `<div style="color:var(--accent);font-weight:700;margin-bottom:6px;">✓ Import complete</div>`,
      res.categories_added ? `<div>Categories added: <strong>${res.categories_added}</strong></div>` : '',
      res.rooms_added      ? `<div>Rooms added: <strong>${res.rooms_added}</strong></div>` : '',
      res.items_added      ? `<div>Items added: <strong>${res.items_added}</strong></div>` : '',
      res.items_skipped    ? `<div>Items skipped (existing): <strong>${res.items_skipped}</strong></div>` : '',
      res.boxes_added      ? `<div>Boxes created: <strong>${res.boxes_added}</strong></div>` : '',
      res.box_items_added  ? `<div>Box entries restored: <strong>${res.box_items_added}</strong></div>` : '',
    ];
    result.innerHTML = lines.filter(Boolean).join('');
    toast(`Import complete`);
    _importData = null;
    runBtn.style.display = 'none';
  } catch(e) {
    result.innerHTML = `<span style="color:#c33">❌ ${esc(e.message)}</span>`;
    toast(`Import failed: ${e.message}`, true);
  } finally {
    runBtn.disabled = false;
    runBtn.textContent = '✓ Import Now';
  }
}

function importReset() {
  _importData = null;
  document.getElementById('import-file').value = '';
  document.getElementById('import-preview').style.display = 'none';
  document.getElementById('import-run-btn').style.display = 'none';
  document.getElementById('import-result').innerHTML = '';
}

// ── Export ────────────────────────────────────────────────────────────────

async function exportScopeChanged() {
  const scope = document.querySelector('input[name="export-scope"]:checked').value;
  const picker = document.getElementById('export-box-picker');
  if (scope === 'select') {
    picker.style.display = 'block';
    await populateExportBoxList();
  } else {
    picker.style.display = 'none';
  }
}

async function populateExportBoxList() {
  const list = document.getElementById('export-box-list');
  list.innerHTML = '<div style="color:var(--muted);font-size:12px;">Loading…</div>';
  try {
    const boxes = await api('/api/boxes');
    if (!boxes.length) {
      list.innerHTML = '<div style="color:var(--muted);font-size:13px;">No boxes found.</div>';
      return;
    }
    list.innerHTML = '';
    // Group by room
    const byRoom = {};
    boxes.forEach(b => {
      const room = b.room_name || '(No Room)';
      if (!byRoom[room]) byRoom[room] = [];
      byRoom[room].push(b);
    });
    Object.keys(byRoom).sort().forEach(room => {
      const roomHdr = document.createElement('div');
      roomHdr.style.cssText = 'font-size:11px;font-weight:700;letter-spacing:1px;' +
        'text-transform:uppercase;color:var(--muted);margin:8px 0 4px;';
      roomHdr.textContent = room;
      list.appendChild(roomHdr);
      byRoom[room].forEach(b => {
        const label = document.createElement('label');
        label.style.cssText = 'display:flex;align-items:center;gap:8px;' +
          'font-size:14px;cursor:pointer;padding:3px 0;';
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.value = b.id; cb.checked = true;
        cb.className = 'export-box-cb';
        const txt = document.createTextNode(
          `BOX ${b.box_number}${b.label ? ' · ' + b.label : ''} (${b.item_count} type${b.item_count !== 1 ? 's' : ''})`
        );
        label.appendChild(cb); label.appendChild(txt);
        list.appendChild(label);
      });
    });

    // Select all / none helpers
    const helpers = document.createElement('div');
    helpers.style.cssText = 'margin-top:10px;display:flex;gap:8px;';
    helpers.innerHTML = `
      <button class="btn btn-secondary btn-sm"
        onclick="document.querySelectorAll('.export-box-cb').forEach(c=>c.checked=true)">
        All
      </button>
      <button class="btn btn-secondary btn-sm"
        onclick="document.querySelectorAll('.export-box-cb').forEach(c=>c.checked=false)">
        None
      </button>`;
    list.appendChild(helpers);
  } catch(e) {
    list.innerHTML = `<span style="color:#c33">${esc(e.message)}</span>`;
  }
}

async function exportRun() {
  const status = document.getElementById('export-status');
  const scope = document.querySelector('input[name="export-scope"]:checked').value;
  status.textContent = 'Building export…';

  try {
    let body = {};
    if (scope === 'select') {
      const checked = [...document.querySelectorAll('.export-box-cb:checked')];
      if (!checked.length) { toast('Select at least one box', true); status.textContent = ''; return; }
      body.box_ids = checked.map(c => parseInt(c.value));
    }

    const data = await api('/api/export', { method: 'POST', body: JSON.stringify(body) });

    // Build download
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `boxtrack-backup-${date}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    const boxCount = data.boxes.length;
    const itemCount = data.items.length;
    status.textContent = `✓ Exported ${boxCount} box${boxCount !== 1 ? 'es' : ''}, ${itemCount} item${itemCount !== 1 ? 's' : ''}`;
    toast('Backup downloaded');
  } catch(e) {
    status.textContent = '';
    toast(`Export failed: ${e.message}`, true);
  }
}

// ── Reset ─────────────────────────────────────────────────────────────────

function resetStep1() {
  openModal('modal-reset-1');
}

function resetStep2() {
  closeModal('modal-reset-1');
  document.getElementById('reset-confirm-input').value = '';
  document.getElementById('reset-confirm-btn').disabled = true;
  openModal('modal-reset-2');
  document.getElementById('reset-confirm-input').focus();
}

function resetConfirmCheck() {
  const val = document.getElementById('reset-confirm-input').value;
  document.getElementById('reset-confirm-btn').disabled =
    (val !== 'I want to delete all data');
}

async function resetRun() {
  const btn = document.getElementById('reset-confirm-btn');
  btn.disabled = true;
  btn.textContent = '⟳ Deleting…';
  try {
    await api('/api/reset', {
      method: 'POST',
      body: JSON.stringify({ phrase: 'I want to delete all data' }),
    });
    closeModal('modal-reset-2');
    toast('All data deleted');
    // Reload all panels
    loadBoxes();
    loadRooms();
    loadItems();
    loadCategories();
    showPanel('boxes');
  } catch(e) {
    toast(`Reset failed: ${e.message}`, true);
    btn.disabled = false;
    btn.textContent = 'Delete Everything';
  }
}
