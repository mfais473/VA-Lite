const DEFAULT_ROWS = 50;
const MAX_COLS = 50;
const MAX_CELL_CHARS = 200;
const TEXT_BUDGET = 12000;

function isoDate(d) {
  if (Number.isNaN(d.getTime())) return null;
  const iso = d.toISOString();
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.replace('.000Z', 'Z');
}

function normalizeCell(v) {
  if (v === null || v === undefined) return { value: null, formula: false };
  if (v instanceof Date) return { value: isoDate(v), formula: false };
  if (typeof v === 'number') return { value: Number.isFinite(v) ? v : null, formula: false };
  if (typeof v === 'boolean') return { value: v, formula: false };
  if (typeof v === 'string') return { value: v, formula: false };

  if (typeof v === 'object') {
    if (v.formula !== undefined || v.sharedFormula !== undefined) {
      return { value: normalizeCell(v.result).value, formula: true };
    }
    if (Array.isArray(v.richText)) {
      return { value: v.richText.map((p) => (p && p.text) || '').join(''), formula: false };
    }
    if (v.hyperlink !== undefined) {
      return { value: normalizeCell(v.text !== undefined ? v.text : v.hyperlink).value, formula: false };
    }
    if (v.error !== undefined) return { value: String(v.error), formula: false };
    if (v.text !== undefined) return { value: String(v.text), formula: false };
    try {
      return { value: JSON.stringify(v), formula: false };
    } catch {
      return { value: null, formula: false };
    }
  }
  return { value: String(v), formula: false };
}

function sliceSheet(ws, { startRow = 1, maxRows = DEFAULT_ROWS, showFormulas = false } = {}) {
  const totalRows = ws.rowCount || 0;
  const totalCols = ws.columnCount || 0;
  const cols = Math.min(totalCols, MAX_COLS);
  const last = Math.min(totalRows, startRow + maxRows - 1);
  const rows = [];
  let formulaCells = 0;
  let trimmedCells = 0;
  let chars = 0;

  for (let r = startRow; r <= last; r++) {
    const row = ws.getRow(r);
    const out = [];
    for (let c = 1; c <= cols; c++) {
      const cell = row.getCell(c);
      const n = normalizeCell(cell.value);
      let value = n.value;
      if (showFormulas && n.formula) {
        const f = typeof cell.formula === 'string' && cell.formula ? cell.formula : (cell.value && cell.value.formula);
        if (typeof f === 'string' && f) value = `=${f}`;
      }
      if (typeof value === 'string' && value.length > MAX_CELL_CHARS) {
        value = value.slice(0, MAX_CELL_CHARS);
        trimmedCells += 1;
      }
      if (n.formula) formulaCells += 1;
      out.push(value);
    }
    while (out.length && out[out.length - 1] === null) out.pop();   

    const size = JSON.stringify(out).length;
    if (rows.length && chars + size > TEXT_BUDGET) break;         
    rows.push(out);
    chars += size;
  }

  const endRow = startRow + rows.length - 1;
  const hasMoreRows = rows.length > 0 ? endRow < totalRows : false;
  const complete =
    startRow === 1 && !hasMoreRows && totalCols <= MAX_COLS && trimmedCells === 0;

  return {
    rows,
    totalRows,
    totalCols,
    formulaCells,
    trimmedCells,
    colsTruncated: totalCols > MAX_COLS,
    nextStartRow: hasMoreRows ? endRow + 1 : null,
    complete,
  };
}

function headerOf(ws) {
  const cols = Math.min(ws.columnCount || 0, MAX_COLS);
  if (!ws.rowCount || !cols) return [];
  const row = ws.getRow(1);
  const out = [];
  for (let c = 1; c <= cols; c++) {
    const v = normalizeCell(row.getCell(c).value).value;
    out.push(v === null ? '' : String(v).slice(0, 40));
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

module.exports = { DEFAULT_ROWS, MAX_COLS, MAX_CELL_CHARS, TEXT_BUDGET, normalizeCell, sliceSheet, headerOf };
