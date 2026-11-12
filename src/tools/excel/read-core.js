const fs = require('fs/promises');
const { toInt } = require('../file-utils');
const { DEFAULT_ROWS, MAX_COLS, sliceSheet, headerOf } = require('./read-slice');

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_ROWS_PER_CALL = 200;

async function readExcelFile(target, { sheetName, startRow, maxRows, showFormulas } = {}) {
  const stat = await fs.stat(target);
  if (!stat.isFile()) return { success: false, error: 'Path bukan file' };
  if (stat.size > MAX_BYTES) return { success: false, error: 'File Excel terlalu besar (maks 20 MB)' };
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(target);
  const names = wb.worksheets.map((w) => w.name);
  if (!names.length) return { success: false, error: 'File Excel tidak punya sheet' };
  const ws = sheetName ? wb.getWorksheet(sheetName) : wb.worksheets[0];
  if (!ws) {
    return { success: false, error: `Sheet "${sheetName}" tidak ada. Sheet yang tersedia: ${names.join(', ')}` };
  }
  const start = toInt(startRow, 1, 1, 1000000);
  const limit = toInt(maxRows, DEFAULT_ROWS, 1, MAX_ROWS_PER_CALL);
  const showF = String(showFormulas || '').trim().toLowerCase() === 'true';
  const slice = sliceSheet(ws, { startRow: start, maxRows: limit, showFormulas: showF });
  const result = {
    success: true,
    path: target,
    sheet: ws.name,
    sheets: names,
    totalRows: slice.totalRows,
    totalCols: slice.totalCols,
    columns: headerOf(ws),
    startRow: start,
    returnedRows: slice.rows.length,
    nextStartRow: slice.nextStartRow,
    formulaCells: slice.formulaCells,
    ...(showF ? { formulasShown: true } : {}),
    complete: slice.complete,
    text: JSON.stringify(slice.rows),
  };
  if (!slice.complete) {
    const reasons = [];
    if (start > 1) reasons.push('dibaca mulai di tengah sheet');
    if (slice.nextStartRow) reasons.push('masih ada baris berikutnya');
    if (slice.colsTruncated) reasons.push(`kolom dipotong di ${MAX_COLS}`);
    if (slice.trimmedCells) reasons.push(`${slice.trimmedCells} sel teks dipotong`);
    result.note =
      `Data BELUM lengkap (${reasons.join('; ') || 'sebagian'}). ` +
      'Jangan membuat ulang file dari data ini.';
  }
  return result;
}

async function readExcelOverview(target, { rowsPerSheet = 30, charBudget = 6000 } = {}) {
  const stat = await fs.stat(target);
  if (!stat.isFile()) return { success: false, error: 'Path bukan file' };
  if (stat.size > MAX_BYTES) return { success: false, error: 'File Excel terlalu besar (maks 20 MB)' };
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(target);
  if (!wb.worksheets.length) return { success: false, error: 'File Excel tidak punya sheet' };

  const sheets = [];
  let used = 0;
  let complete = true;
  for (const ws of wb.worksheets) {
    const budgetLeft = charBudget - used;
    if (budgetLeft < 200 && sheets.length) {
      sheets.push({ sheet: ws.name, totalRows: ws.rowCount || 0, totalCols: ws.columnCount || 0, skipped: true });
      complete = false;
      continue;
    }
    const slice = sliceSheet(ws, { startRow: 1, maxRows: rowsPerSheet });
    let rows = slice.rows;
    let text = JSON.stringify(rows);
    let cut = false;
    while (text.length > budgetLeft && rows.length > 1) {
      rows = rows.slice(0, Math.max(1, Math.floor(rows.length / 2)));
      text = JSON.stringify(rows);
      cut = true;
    }
    used += text.length;
    const sheetComplete = slice.complete && !cut;
    if (!sheetComplete) complete = false;
    sheets.push({
      sheet: ws.name,
      totalRows: slice.totalRows,
      totalCols: slice.totalCols,
      columns: headerOf(ws),
      returnedRows: rows.length,
      complete: sheetComplete,
      rows,
    });
  }
  return { success: true, path: target, sheets, complete };
}

module.exports = { readExcelFile, readExcelOverview, MAX_BYTES, MAX_ROWS_PER_CALL };
