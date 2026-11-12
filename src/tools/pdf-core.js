const fs = require('fs/promises');
const { toInt } = require('./file-utils');

const MAX_BYTES = 50 * 1024 * 1024;
const BUDGET_CHARS = 8000;

const picked = require('./picked-access');

function markPicked(p) { picked.grantFile(p); }
function wasPicked(p) { return picked.isGranted(p); }
function resetPicked() { picked.reset(); }

async function extractPages(buffer) {
  const { extractText } = require('unpdf');
  const { text, totalPages } = await extractText(new Uint8Array(buffer), { mergePages: false });
  const pages = (Array.isArray(text) ? text : [String(text || '')]).map((p) => (p || '').trim());
  return { pages, totalPages: totalPages || pages.length };
}

function slicePages(pages, { startPage = 1, endPage, budget = BUDGET_CHARS } = {}) {
  const total = pages.length;
  const start = Math.min(Math.max(Math.floor(startPage) || 1, 1), total);
  const wantEnd = endPage === undefined ? total : Math.floor(endPage) || total;
  const end = Math.min(Math.max(wantEnd, start), total);

  let text = '';
  let last = start - 1;
  let pageTruncated = false;
  for (let p = start; p <= end; p++) {
    const block = `--- Halaman ${p} ---\n${pages[p - 1]}`;
    const joined = text ? `${text}\n\n${block}` : block;
    if (joined.length > budget) {
      if (!text) {
        text = block.slice(0, budget);
        last = p;
        pageTruncated = true;
      }
      break;
    }
    text = joined;
    last = p;
  }

  const totalChars = pages.reduce((n, p) => n + p.length, 0);
  return {
    text,
    startPage: start,
    endPage: last,
    nextStartPage: last < total ? last + 1 : null,
    complete: start === 1 && last === total && !pageTruncated,
    pageTruncated,
    totalChars,
    noText: totalChars === 0,
  };
}

function buildNote(s) {
  const notes = [];
  if (s.noText) {
    notes.push(
      'PDF ini tidak punya teks yang bisa diambil (kemungkinan hasil scan atau berisi gambar saja). ' +
      'Minta pengguna memberi foto atau screenshot halamannya, lalu baca lewat pick_source (kind image).',
    );
  }
  if (s.pageTruncated) notes.push(`Halaman ${s.endPage} terlalu panjang dan bagian akhirnya terpotong.`);
  if (!s.complete && !s.noText) {
    notes.push(
      `Teks BELUM lengkap (baru halaman ${s.startPage}-${s.endPage}).` +
      (s.nextStartPage ? ` Lanjutkan dengan read_pdf startPage=${s.nextStartPage}.` : '') +
      ' Jangan menyimpulkan isi halaman yang belum dibaca.',
    );
  }
  return notes.join(' ');
}

async function readPdfFile(filePath, { startPage, endPage } = {}) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) return { success: false, error: 'Path bukan file' };
  if (stat.size > MAX_BYTES) return { success: false, error: 'File PDF terlalu besar (maks 50 MB)' };

  const buffer = await fs.readFile(filePath);
  const { pages, totalPages } = await extractPages(buffer);
  if (!pages.length) return { success: false, error: 'PDF ini tidak punya halaman' };

  const s = slicePages(pages, {
    startPage: toInt(startPage, 1, 1, 1000000),
    endPage: endPage === undefined ? undefined : toInt(endPage, totalPages, 1, 1000000),
  });
  const note = buildNote(s);
  return {
    success: true,
    path: filePath,
    pages: totalPages,
    startPage: s.startPage,
    endPage: s.endPage,
    nextStartPage: s.nextStartPage,
    complete: s.complete,
    truncated: !s.complete,
    length: s.totalChars,
    ...(note ? { note } : {}),
    text: s.text,
  };
}

function historyNote(args, result) {
  if (!result || !result.success) return '';
  return `halaman ${result.startPage}-${result.endPage} dari ${result.pages}` +
    (result.nextStartPage ? `; belum dibaca mulai halaman ${result.nextStartPage}` : '; seluruh dokumen sudah dibaca');
}

module.exports = {
  extractPages, slicePages, readPdfFile, historyNote,
  markPicked, wasPicked, resetPicked,
  MAX_BYTES, BUDGET_CHARS,
};
