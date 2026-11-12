const { MAX_TEXT, FORMULA_BLOCKED } = require('./limits');

function isFormulaString(v) {
  return typeof v === 'string' && v.length > 1 && v.startsWith('=');
}

function checkValue(v) {
  if (v === null || v === undefined || typeof v === 'boolean') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? null : 'angka tidak valid (NaN/Infinity)';
  if (typeof v !== 'string') return 'nilai sel harus angka, teks, true/false, atau null';
  if (v.length > MAX_TEXT) return `teks terlalu panjang (maks ${MAX_TEXT} karakter)`;
  if (isFormulaString(v)) {
    const f = v.slice(1);
    if (f.includes('|') || /\[[^\]]*\]/.test(f)) return `rumus ditolak (rujukan eksternal / karakter berbahaya): ${v.slice(0, 60)}`;
    if (FORMULA_BLOCKED.test(f)) return `rumus ditolak (fungsi jaringan/eksekusi tidak diizinkan): ${v.slice(0, 60)}`;
  }
  return null;
}

function toCell(v) {
  if (v === null || v === undefined) return null;
  if (isFormulaString(v)) return { formula: v.slice(1) };
  return v;
}

module.exports = { isFormulaString, checkValue, toCell };
