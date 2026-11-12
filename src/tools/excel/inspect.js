async function fidelityIssues(buffer) {
  let names;
  try {
    const JSZip = require('jszip');
    names = Object.keys((await JSZip.loadAsync(buffer)).files);
  } catch {
    return [];
  }
  const issues = [];
  if (names.some((n) => n.startsWith('xl/charts/'))) issues.push('grafik (chart)');
  if (names.some((n) => n.startsWith('xl/pivotTables/'))) issues.push('pivot table');
  if (names.some((n) => /^xl\/(slicers|timelines)\//.test(n))) issues.push('slicer/timeline');
  if (names.some((n) => n.startsWith('xl/embeddings/'))) issues.push('objek tertanam');
  if (names.includes('xl/vbaProject.bin')) issues.push('makro');
  return issues;
}

function headerOf(ws) {
  const cols = Math.min(ws.columnCount || 0, 20);
  if (!ws.rowCount || !cols) return [];
  const out = [];
  for (let c = 1; c <= cols; c++) {
    let v = ws.getRow(1).getCell(c).value;
    if (v && typeof v === 'object') v = v.richText ? v.richText.map((p) => p.text).join('') : v.text ?? v.result ?? '';
    out.push(v === null || v === undefined ? '' : String(v).slice(0, 40));
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

module.exports = { fidelityIssues, headerOf };
