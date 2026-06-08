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

// ── Self-contained QR code SVG generator (no external library) ────────────
// Implements QR Code Model 2, byte mode, error correction level M.
// Returns a <div> containing an inline <svg> — vector, sharp at any DPI.
(function() {
  // Reed-Solomon GF(256) arithmetic
  const GF = (function() {
    const exp = new Uint8Array(512), log = new Uint8Array(256);
    let x = 1;
    for (let i = 0; i < 255; i++) {
      exp[i] = x; log[x] = i; x = x < 128 ? x * 2 : (x * 2) ^ 0x11d;
    }
    for (let i = 255; i < 512; i++) exp[i] = exp[i - 255];
    return {
      mul(a, b) { return a && b ? exp[log[a] + log[b]] : 0; },
      poly(ec) {
        let g = [1];
        for (let i = 0; i < ec; i++) {
          const r = [1, exp[i]];
          const t = new Uint8Array(g.length + 1);
          for (let j = 0; j < g.length; j++)
            for (let k = 0; k < r.length; k++)
              t[j + k] ^= GF.mul(g[j], r[k]);
          g = Array.from(t);
        }
        return g;
      }
    };
  })();

  function rsEncode(data, eclen) {
    const gen = GF.poly(eclen);
    const msg = [...data, ...new Array(eclen).fill(0)];
    for (let i = 0; i < data.length; i++) {
      const c = msg[i];
      if (c) for (let j = 0; j < gen.length; j++) msg[i + j] ^= GF.mul(gen[j], c);
    }
    return msg.slice(data.length);
  }

  // QR version/ec tables — version 1-10 M level (we pick smallest that fits)
  // [version, totalCodewords, ecCodewordsPerBlock, blocks, dataCodewords]
  const VER_M = [
    [1,26,10,1,16],[2,44,16,1,28],[3,70,26,1,44],[4,100,18,2,64],
    [5,134,24,2,86],[6,172,16,4,108],[7,196,18,4,124],[8,242,22,4,154],
    [9,292,22,5,182],[10,346,26,6,216],
  ];

  function encodeData(text) {
    const bytes = [];
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c > 0xFF) { bytes.push(0x3F); continue; } // replace non-latin
      bytes.push(c);
    }
    return bytes;
  }

  function buildBitstream(bytes, version) {
    const bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    push(0b0100, 4);              // byte mode
    push(bytes.length, version < 10 ? 8 : 16);
    bytes.forEach(b => push(b, 8));
    push(0, 4);                   // terminator
    while (bits.length % 8) bits.push(0);
    const pads = [0xEC, 0x11];
    let pi = 0;
    while (bits.length < VER_M[version - 1][4] * 8) { push(pads[pi++ % 2], 8); }
    return bits;
  }

  function bitsToBytes(bits) {
    const out = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | (bits[i + j] || 0);
      out.push(b);
    }
    return out;
  }

  function interleaveBlocks(dataBytes, version) {
    const [, , ecPerBlock, numBlocks, totalData] = VER_M[version - 1];
    const blockSize = Math.floor(totalData / numBlocks);
    const extra = totalData % numBlocks;
    const blocks = [], ecBlocks = [];
    let pos = 0;
    for (let b = 0; b < numBlocks; b++) {
      const len = blockSize + (b >= numBlocks - extra ? 1 : 0);
      const block = dataBytes.slice(pos, pos + len); pos += len;
      blocks.push(block);
      ecBlocks.push(rsEncode(block, ecPerBlock));
    }
    const out = [];
    const maxLen = Math.max(...blocks.map(b => b.length));
    for (let i = 0; i < maxLen; i++) blocks.forEach(b => { if (i < b.length) out.push(b[i]); });
    for (let i = 0; i < ecPerBlock; i++) ecBlocks.forEach(b => out.push(b[i]));
    return out;
  }

  function makeMatrix(version) {
    const size = version * 4 + 17;
    const mat = Array.from({ length: size }, () => new Array(size).fill(-1));
    const set = (r, c, v) => { if (r >= 0 && r < size && c >= 0 && c < size) mat[r][c] = v; };

    // Finder patterns
    const finder = (tr, tc) => {
      for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
        const v = r === -1||r===7||c===-1||c===7 ? 1 : r>=2&&r<=4&&c>=2&&c<=4 ? 1 : r===1||r===5||c===1||c===5 ? 0 : -2;
        if (v !== -2) set(tr + r, tc + c, v);
      }
    };
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

    // Timing strips
    for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0 ? 1 : 0); set(i, 6, i % 2 === 0 ? 1 : 0); }

    // Dark module
    set(size - 8, 8, 1);

    // Alignment patterns (version >= 2)
    const AP = [[],[],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50]];
    const ap = AP[version - 1] || [];
    for (const r of ap) for (const c of ap) {
      if (mat[r][c] !== -1) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++)
        set(r + dr, c + dc, dr===0&&dc===0 ? 1 : Math.abs(dr)===2||Math.abs(dc)===2 ? 1 : 0);
    }

    return { mat, size };
  }

  function placeData(mat, size, codewords) {
    let bitIdx = 0;
    const totalBits = codewords.length * 8;
    const getBit = () => bitIdx < totalBits ? (codewords[bitIdx >> 3] >> (7 - (bitIdx++ & 7))) & 1 : 0;

    let dir = -1, col = size - 1;
    while (col >= 0) {
      if (col === 6) col--;
      for (let row = dir === -1 ? size - 1 : 0; row >= 0 && row < size; row += dir) {
        for (let dc = 0; dc < 2; dc++) {
          const c = col - dc;
          if (mat[row][c] === -1) mat[row][c] = getBit() ? 10 : 11;
        }
      }
      dir = -dir; col -= 2;
    }
  }

  const MASKS = [
    (r,c)=>(r+c)%2===0, (r,_)=>r%2===0, (_,c)=>c%3===0,
    (r,c)=>(r+c)%3===0, (r,c)=>(Math.floor(r/2)+Math.floor(c/3))%2===0,
    (r,c)=>(r*c)%2+(r*c)%3===0, (r,c)=>((r*c)%2+(r*c)%3)%2===0,
    (r,c)=>((r+c)%2+(r*c)%3)%2===0,
  ];

  // Format info strings for M level, masks 0-7
  const FMT_M = [
    0x5BC0,0x5465,0x5E2A,0x5B8F,0x45F9,0x40FC,0x4AB3,0x4F16
  ];

  function applyMaskAndFormat(mat, size, maskIdx) {
    const fn = MASKS[maskIdx];
    const m = mat.map(r => [...r]);
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      if (m[r][c] === 10 || m[r][c] === 11) {
        m[r][c] = (m[r][c] === 10) !== fn(r, c) ? 1 : 0;
      } else if (m[r][c] < 0) m[r][c] = 0;
    }

    // Write format information — QR spec section 8.9
    // 15 bits placed in two copies on the matrix.
    const fmt = FMT_M[maskIdx];
    const b = [];
    for (let i = 14; i >= 0; i--) b.push((fmt >> i) & 1);
    // b[0]..b[14] = format bits MSB→LSB

    // Copy 1: around top-left finder
    // Row 8, columns 0-5 → bits 0-5
    for (let i = 0; i < 6; i++) m[8][i] = b[i];
    // Row 8, column 7 → bit 6  (column 6 is timing)
    m[8][7] = b[6];
    // Row 8, column 8 → bit 7
    m[8][8] = b[7];
    // Column 8, row 7 → bit 8  (row 6 is timing)
    m[7][8] = b[8];
    // Column 8, rows 5-0 → bits 9-14
    for (let i = 0; i < 6; i++) m[5 - i][8] = b[9 + i];

    // Copy 2: top-right and bottom-left finders
    // Column 8, rows size-7 .. size-1 → bits 0-6  (bottom-left)
    for (let i = 0; i < 7; i++) m[size - 7 + i][8] = b[i];
    // Row 8, columns size-8 .. size-1 → bits 7-14  (top-right, reversed)
    for (let i = 0; i < 8; i++) m[8][size - 8 + i] = b[7 + i];

    // Dark module (always 1)
    m[size - 8][8] = 1;

    return m;
  }

  function penalty(m, size) {
    let score = 0;
    for (let r = 0; r < size; r++) {
      let run = 1;
      for (let c = 1; c < size; c++) {
        if (m[r][c] === m[r][c-1]) { run++; if (run === 5) score += 3; else if (run > 5) score++; }
        else run = 1;
      }
    }
    // (simplified — just N1 rule is enough to pick a reasonable mask)
    return score;
  }

  function buildQR(text) {
    const bytes = encodeData(text);
    let version = 1;
    for (const [v, , , , dc] of VER_M) { version = v; if (dc >= bytes.length + 3) break; }

    const bits = buildBitstream(bytes, version);
    const dataBytes = bitsToBytes(bits);
    const codewords = interleaveBlocks(dataBytes, version);

    const { mat, size } = makeMatrix(version);
    placeData(mat, size, codewords);

    let bestMask = 0, bestScore = Infinity;
    for (let mi = 0; mi < 8; mi++) {
      const s = penalty(applyMaskAndFormat(mat, size, mi), size);
      if (s < bestScore) { bestScore = s; bestMask = mi; }
    }

    return { grid: applyMaskAndFormat(mat, size, bestMask), size };
  }

  window.makeSVGQR = function(boxNumber, sizePx) {
    const url = `${location.origin}${API_BASE}/?box=${boxNumber}`;
    const { grid, size } = buildQR(url);
    const quiet = 2;
    const total = size + quiet * 2;
    const cell = sizePx / total;

    let path = '';
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (grid[r][c] === 1) {
          const x = (c + quiet) * cell, y = (r + quiet) * cell;
          path += `M${x},${y}h${cell}v${cell}h-${cell}z`;
        }
      }
    }

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', sizePx);
    svg.setAttribute('height', sizePx);
    svg.setAttribute('viewBox', `0 0 ${sizePx} ${sizePx}`);
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.style.cssText = `display:block;width:${sizePx}px;height:${sizePx}px;shape-rendering:crispEdges;`;

    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('width', sizePx); bg.setAttribute('height', sizePx); bg.setAttribute('fill', '#fff');
    svg.appendChild(bg);

    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathEl.setAttribute('d', path); pathEl.setAttribute('fill', '#000');
    svg.appendChild(pathEl);

    const wrap = document.createElement('div');
    wrap.style.cssText = `width:${sizePx}px;height:${sizePx}px;flex-shrink:0;line-height:0;`;
    wrap.appendChild(svg);
    return wrap;
  };
})();

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
  // QR needs to be large enough to scan — at least 40% of the short edge, min 18mm
  const shortMM = Math.min(wMM, hMM);
  const qrMM    = Math.max(18, Math.min(Math.round(shortMM * 0.42), 32));
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

    const qrWrap = makeSVGQR(box.box_number, qrPx);
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

    const qrWrap = makeSVGQR(box.box_number, qrPx);

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

  // Clone the label, strip px sizing — the print window uses mm
  const clone = target.cloneNode(true);
  clone.style.width  = `${wMM}mm`;
  clone.style.height = `${hMM}mm`;
  // Ensure any inline px widths/heights on child divs also use mm
  // (SVG elements are already vector and will scale correctly)

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>BoxTrack Label</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;900&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: ${wMM}mm; height: ${hMM}mm;
      overflow: hidden; background: #fff;
    }
    @page { size: ${wMM}mm ${hMM}mm; margin: 0; }
    body { display: flex; align-items: stretch; }
    .label-preview {
      width: ${wMM}mm !important;
      height: ${hMM}mm !important;
    }
    /* Ensure SVG QR fills its container exactly */
    .label-preview svg { display: block; }
    /* Text uses Barlow Condensed like the preview */
    div { font-family: 'Barlow Condensed', sans-serif; }
  </style>
</head>
<body>
${clone.outerHTML}
</body>
</html>`;

  const win = window.open('', '_blank', 'width=500,height=600');
  if (!win) {
    // Popup blocked — try window.print() directly
    window.print();
    return;
  }
  win.document.write(html);
  win.document.close();
  win.focus();
  // Wait for fonts before printing
  setTimeout(() => { win.print(); }, 800);
}
