const { MAX_ROW, MAX_COL } = require('./limits');

function colToNum(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function parseAddress(s) {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(String(s || '').trim());
  if (!m) return null;
  const col = colToNum(m[1]);
  const row = parseInt(m[2], 10);
  if (col < 1 || col > MAX_COL || row < 1 || row > MAX_ROW) return null;
  return { col, row };
}

function parseRange(s) {
  const parts = String(s || '').split(':');
  if (parts.length > 2) return null;
  const a = parseAddress(parts[0]);
  const b = parts.length === 2 ? parseAddress(parts[1]) : a;
  if (!a || !b) return null;
  return {
    c1: Math.min(a.col, b.col), r1: Math.min(a.row, b.row),
    c2: Math.max(a.col, b.col), r2: Math.max(a.row, b.row),
  };
}

module.exports = { colToNum, parseAddress, parseRange };
