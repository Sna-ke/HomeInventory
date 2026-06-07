// ── Print / QR ─────────────────────────────────────────────────────────────
// Niimbot B1 label sizes: { key: [widthMM, heightMM] }
// We render at 96 DPI screen preview (~3.78px per mm), but print CSS uses mm directly.
const LABEL_SIZES = {
  '50x30': [50, 30], '40x30': [40, 30], '40x40': [40, 40], '50x50': [50, 50],
  '40x60': [40, 60], '40x70': [40, 70], '50x70': [50, 70], '50x80': [50, 80],
};
const MM_TO_PX = 3.3; // approx screen preview scale

async function openPrintModal(boxId) {
  const box = await api(`/api/boxes/${boxId}`);
  currentPrintBox = box;
  openModal('modal-print');
  updateLabelPreview();
}

function updateLabelPreview() {
  if (!currentPrintBox) return;
  const box = currentPrintBox;
  const sizeKey = document.getElementById('label-size-select').value;
  let [wMM, hMM] = LABEL_SIZES[sizeKey] || [40, 60];
  // Apply orientation override
  const naturalLandscape = wMM >= hMM;
  if (labelOrientation === 'landscape' && !naturalLandscape) { [wMM, hMM] = [hMM, wMM]; }
  if (labelOrientation === 'portrait'  &&  naturalLandscape && wMM !== hMM) { [wMM, hMM] = [hMM, wMM]; }
  const isLandscape = wMM >= hMM;

  // Body text: prefer description, fall back to unique categories
  let bodyText = box.description || '';
  if (!bodyText && box.items && box.items.length) {
    const cats = [...new Set(box.items.map(i => i.category).filter(Boolean))];
    bodyText = cats.length ? cats.join(', ') : '';
  }

  const pxW = Math.round(wMM * MM_TO_PX);
  const pxH = Math.round(hMM * MM_TO_PX);
  const PAD = 4; // px inner padding

  // ── QR size ───────────────────────────────────────────────────────────────
  // Cap at 30% of the short edge (never more than 20mm) so text always wins.
  const shortMM = Math.min(wMM, hMM);
  // QR needs to be large enough for a phone to scan: at least 25% of short edge, minimum 15mm
  const qrMM    = Math.max(15, Math.min(Math.round(shortMM * 0.38), 30));
  const qrPx    = Math.round(qrMM * MM_TO_PX);
  const numSize = Math.max(7, Math.round(qrPx * 0.24));

  const target = document.getElementById('print-target');
  target.className = 'label-preview';
  target.dataset.printW = wMM;
  target.dataset.printH = hMM;
  target.innerHTML = '';

  // ── Layout: landscape → QR left column, text right
  //            portrait  → QR top strip, text below
  // "landscape" here means wMM > hMM (strictly wider than tall)
  if (isLandscape) {
    // ── LANDSCAPE ─────────────────────────────────────────────────────────
    const qrColW  = qrPx + PAD * 2;
    const textW   = pxW - qrColW;
    const titleSz = Math.max(8, Math.min(22, Math.round(textW * 0.12)));
    const bodySz  = Math.max(7, Math.min(15, Math.round(textW * 0.09)));

    target.style.cssText = `width:${pxW}px;height:${pxH}px;
      display:flex;flex-direction:row;align-items:stretch;background:#fff;`;

    const left = document.createElement('div');
    left.style.cssText = `width:${qrColW}px;flex-shrink:0;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      padding:${PAD}px;border-right:1px solid #ccc;background:#fff;`;

    const qrWrap = document.createElement('div');
    qrWrap.id = 'qr-container';
    new QRCode(qrWrap, {
      text: `${location.origin}${API_BASE}/?box=${box.box_number}`,
      width: qrPx, height: qrPx, correctLevel: QRCode.CorrectLevel.L,
    });
    const numEl = document.createElement('div');
    numEl.style.cssText = `font-size:${numSize}px;margin-top:2px;text-align:center;
      font-family:'Barlow Condensed',sans-serif;font-weight:900;color:#000;line-height:1;`;
    numEl.textContent = `BOX ${box.box_number}`;
    left.appendChild(qrWrap); left.appendChild(numEl);

    const right = document.createElement('div');
    right.style.cssText = `flex:1;min-width:0;display:flex;flex-direction:column;
      justify-content:center;padding:${PAD}px ${PAD+2}px;gap:2px;overflow:hidden;background:#fff;`;

    if (box.label) {
      const t = document.createElement('div');
      t.style.cssText = `font-size:${titleSz}px;font-weight:700;
        font-family:'Barlow Condensed',sans-serif;color:#000;line-height:1.15;word-break:break-word;`;
      t.textContent = box.label; right.appendChild(t);
    }
    if (bodyText) {
      const b = document.createElement('div');
      b.style.cssText = `font-size:${bodySz}px;
        font-family:'Barlow Condensed',sans-serif;color:#222;line-height:1.25;word-break:break-word;`;
      const maxChars = Math.max(40, Math.floor(textW / (bodySz * 0.55)) * Math.floor(pxH / (bodySz * 1.3)));
      b.textContent = bodyText.length > maxChars ? bodyText.substring(0, maxChars) + '…' : bodyText;
      right.appendChild(b);
    }

    target.appendChild(left); target.appendChild(right);

  } else {
    // ── PORTRAIT / SQUARE ─────────────────────────────────────────────────
    // QR strip across the top, text fills the rest below.
    const qrStripH = qrPx + numSize + PAD * 3 + 2;
    const textH    = pxH - qrStripH;
    const titleSz  = Math.max(8, Math.min(22, Math.round(pxW * 0.12)));
    const bodySz   = Math.max(7, Math.min(15, Math.round(pxW * 0.09)));

    target.style.cssText = `width:${pxW}px;height:${pxH}px;
      display:flex;flex-direction:column;align-items:stretch;background:#fff;`;

    // Top strip: QR on left, BOX N on right — side by side to save vertical space
    const top = document.createElement('div');
    top.style.cssText = `flex-shrink:0;height:${qrStripH}px;
      display:flex;flex-direction:row;align-items:center;gap:${PAD}px;
      padding:${PAD}px;border-bottom:1px solid #ccc;background:#fff;`;

    const qrWrap = document.createElement('div');
    qrWrap.id = 'qr-container';
    new QRCode(qrWrap, {
      text: `${location.origin}${API_BASE}/?box=${box.box_number}`,
      width: qrPx, height: qrPx, correctLevel: QRCode.CorrectLevel.L,
    });

    const numEl = document.createElement('div');
    // Box number gets remaining width in the top strip
    const numFontPx = Math.max(12, Math.min(32, Math.round((pxW - qrPx - PAD * 3) * 0.45)));
    numEl.style.cssText = `flex:1;font-size:${numFontPx}px;font-weight:900;
      font-family:'Barlow Condensed',sans-serif;color:#000;line-height:1;
      text-align:center;word-break:break-all;`;
    numEl.textContent = `BOX
${box.box_number}`;

    top.appendChild(qrWrap); top.appendChild(numEl);

    const bottom = document.createElement('div');
    bottom.style.cssText = `flex:1;min-height:0;display:flex;flex-direction:column;
      justify-content:center;padding:${PAD}px ${PAD+2}px;gap:2px;overflow:hidden;background:#fff;`;

    if (box.label) {
      const t = document.createElement('div');
      t.style.cssText = `font-size:${titleSz}px;font-weight:700;
        font-family:'Barlow Condensed',sans-serif;color:#000;line-height:1.15;word-break:break-word;`;
      t.textContent = box.label; bottom.appendChild(t);
    }
    if (bodyText) {
      const b = document.createElement('div');
      b.style.cssText = `font-size:${bodySz}px;
        font-family:'Barlow Condensed',sans-serif;color:#222;line-height:1.25;word-break:break-word;`;
      const maxChars = Math.max(40, Math.floor(pxW / (bodySz * 0.55)) * Math.floor(textH / (bodySz * 1.3)));
      b.textContent = bodyText.length > maxChars ? bodyText.substring(0, maxChars) + '…' : bodyText;
      bottom.appendChild(b);
    }

    target.appendChild(top); target.appendChild(bottom);
  }

  // Inject a dynamic @page rule for printing at the correct size
  let styleEl = document.getElementById('print-page-style');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'print-page-style';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = `@media print { @page { size: ${wMM}mm ${hMM}mm; margin: 0; } }`;
}

// ── Label orientation ──────────────────────────────────────────────────────
let labelOrientation = 'portrait'; // 'portrait' | 'landscape'

function setLabelOrientation(orient) {
  labelOrientation = orient;
  document.getElementById('orient-portrait-btn').classList.toggle('active', orient === 'portrait');
  document.getElementById('orient-landscape-btn').classList.toggle('active', orient === 'landscape');
  updateLabelPreview();
}

// ── Print helper — works on iOS Safari ────────────────────────────────────
function printLabel() {
  const target = document.getElementById('print-target');
  if (!target) return;
  const wMM = target.dataset.printW || 40;
  const hMM = target.dataset.printH || 60;
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>BoxTrack Label</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;900&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: ${wMM}mm; height: ${hMM}mm; overflow: hidden; background: #fff; }
    @page { size: ${wMM}mm ${hMM}mm; margin: 0; }
    @media print { html, body { width: ${wMM}mm; height: ${hMM}mm; } }
    body { display: flex; align-items: stretch; justify-content: stretch; }
    body > * { flex: 1; }
  </style>
</head>
<body>
${target.outerHTML}
</body>
</html>`;
  // Remove the preview scale transform for print window
  const clean = html.replace(/width:\d+px;height:\d+px/, `width:${wMM}mm;height:${hMM}mm`);

  const win = window.open('', '_blank', 'width=400,height=500');
  if (!win) {
    // Popup blocked — fall back to window.print()
    window.print();
    return;
  }
  win.document.write(clean);
  win.document.close();
  win.focus();
  // Delay to allow fonts to load
  setTimeout(() => { win.print(); }, 600);
}
