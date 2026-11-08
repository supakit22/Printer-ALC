// สร้าง PDF สำหรับปริ้นป้าย: A6 (4 ป้าย/A4), A5 (2 ป้าย/A4), A4, A3
const { PDFDocument, rgb, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } = require('pdf-lib');

const A4 = [595.28, 841.89], A3 = [841.89, 1190.55];
// landscapeWhen: แผ่นกระดาษนอนเมื่อรูปส่วนใหญ่ "land" (นอน) หรือ "port" (ตั้ง)
const PRESET = {
  A6: { sheet: A4, per: 4, landscapeWhen: 'land' },
  A5: { sheet: A4, per: 2, landscapeWhen: 'port' },
  A4: { sheet: A4, per: 1, landscapeWhen: 'land' },
  A3: { sheet: A3, per: 1, landscapeWhen: 'land' },
};

function sheetInfo(paper, group) {
  const p = PRESET[paper];
  const land = group.filter((g) => g.w > g.h).length;
  const imgLand = land >= group.length - land;
  const landscape = p.landscapeWhen === 'land' ? imgLand : !imgLand;
  const [w, h] = p.sheet;
  const [pw, ph] = landscape ? [h, w] : [w, h];
  let cols = 1, rows = 1;
  if (p.per === 4) { cols = 2; rows = 2; }
  if (p.per === 2) { landscape ? (cols = 2) : (rows = 2); }
  return { pw, ph, cols, rows };
}

function place(page, it, x, y, cw, ch, fit) {
  let dw = cw, dh = ch, dx = x, dy = y;
  if (fit !== 'stretch') {
    const s = fit === 'cover' ? Math.max(cw / it.w, ch / it.h) : Math.min(cw / it.w, ch / it.h);
    dw = it.w * s; dh = it.h * s; dx = x + (cw - dw) / 2; dy = y + (ch - dh) / 2;
  }
  if (fit === 'cover') page.pushOperators(pushGraphicsState(), rectangle(x, y, cw, ch), clip(), endPath());
  if (it.img) page.drawImage(it.img, { x: dx, y: dy, width: dw, height: dh });
  else page.drawPage(it.pdfPage, { x: dx, y: dy, width: dw, height: dh });
  if (fit === 'cover') page.pushOperators(popGraphicsState());
}

async function loadItems(pdf, files) {
  const items = [];
  for (const f of files) {
    const b = f.buffer;
    if (b.slice(0, 4).toString() === '%PDF') {
      const pages = await pdf.embedPdf(b);
      pages.forEach((e) => items.push({ pdfPage: e, w: e.width, h: e.height }));
    } else {
      const img = b[0] === 0x89 && b[1] === 0x50 ? await pdf.embedPng(b) : await pdf.embedJpg(b);
      items.push({ img, w: img.width, h: img.height });
    }
  }
  return items;
}

async function buildPdf(files, paper, fit) {
  const pdf = await PDFDocument.create();
  const items = await loadItems(pdf, files);
  const per = PRESET[paper].per;
  for (let i = 0; i < items.length; i += per) {
    const group = items.slice(i, i + per);
    const { pw, ph, cols, rows } = sheetInfo(paper, group);
    const page = pdf.addPage([pw, ph]);
    const cw = pw / cols, ch = ph / rows;
    group.forEach((it, k) => {
      const c = k % cols, r = Math.floor(k / cols);
      place(page, it, c * cw, ph - (r + 1) * ch, cw, ch, fit);
    });
    // เส้นไกด์สำหรับตัด
    const line = { thickness: 0.4, color: rgb(0.75, 0.75, 0.75) };
    for (let c = 1; c < cols; c++) page.drawLine({ start: { x: c * cw, y: 0 }, end: { x: c * cw, y: ph }, ...line });
    for (let r = 1; r < rows; r++) page.drawLine({ start: { x: 0, y: r * ch }, end: { x: pw, y: r * ch }, ...line });
  }
  return { bytes: await pdf.save(), count: items.length, sheets: Math.ceil(items.length / per) };
}

module.exports = { buildPdf, PRESET };
