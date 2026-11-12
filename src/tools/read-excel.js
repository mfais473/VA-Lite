const path = require('path');
const { isInsideAllowed } = require('./path-guard');
const picked = require('./picked-access');
const { getLatest } = require('./session-artifacts');
const {
  DEFAULT_ROWS, MAX_COLS, MAX_CELL_CHARS, TEXT_BUDGET, normalizeCell, sliceSheet, headerOf,
} = require('./excel/read-slice');
const { readExcelFile, MAX_ROWS_PER_CALL } = require('./excel/read-core');

const readExcel = {
  name: 'read_excel',
  description:
    'Membaca isi file Excel (.xlsx) dan mengembalikan baris-barisnya sebagai JSON array of array ' +
    '(format yang sama dengan parameter "rows" di create_excel). Pakai saat pengguna ingin membahas, ' +
    'memeriksa, atau mengubah file Excel. Kalau pengguna menyebut "Excel tadi"/"file itu", kosongkan ' +
    '"path": aplikasi memakai file Excel terbaru di sesi ini. File besar dibaca per halaman ' +
    '(startRow/maxRows); cek "complete" dan "nextStartRow" di hasilnya. File di dalam folder yang dipilih ' +
    'pengguna lewat pick_source juga boleh dibaca dengan path persis dari hasil tool.',
  params: {
    path: { type: 'string', required: false, description: 'Path lengkap file .xlsx (kosongkan untuk Excel terbaru di sesi ini)' },
    sheetName: { type: 'string', required: false, description: 'Nama sheet (default: sheet pertama)' },
    startRow: { type: 'string', required: false, description: 'Baris awal, mulai dari 1 (default 1)' },
    showFormulas: { type: 'string', required: false, description: 'Isi "true" untuk menampilkan RUMUS sel (mis. =SUM(B2:B9)) sebagai ganti hasil hitungnya. Pakai sebelum mengubah atau memperbaiki rumus.' },
    maxRows: { type: 'string', required: false, description: `Jumlah baris maksimal (default ${DEFAULT_ROWS}, maks ${MAX_ROWS_PER_CALL})` },
  },
  permission: 'confirm',   
  untrusted: true,         
  describe: ({ path: p }) =>
    `Boleh aku baca isi file Excel ${p ? path.basename(p) : 'tadi'}? Isinya akan dikirim ke layanan AI.`,
  historyNote: (args, result) => (result && result.success
    ? `sheet "${result.sheet}": ${result.totalRows} baris x ${result.totalCols} kolom; kolom: ${(result.columns || []).join(', ')}; ` +
      `dibaca baris ${result.startRow}-${result.startRow + result.returnedRows - 1}${result.complete ? ' (lengkap)' : ' (belum lengkap)'}`
    : ''),
  execute: async ({ path: filePath, sheetName, startRow, maxRows, showFormulas }) => {
    let target = filePath;
    if (!target) {
      const latest = getLatest('excel');
      if (!latest) return { success: false, error: 'Path kosong dan belum ada file Excel di sesi ini' };
      target = latest.path;
    }
    if (!target.toLowerCase().endsWith('.xlsx')) {
      return { success: false, error: 'Hanya file .xlsx yang didukung' };
    }
    if (!isInsideAllowed(target) && !picked.isGranted(target)) {
      return { success: false, error: 'File di luar area yang diizinkan' };
    }
    try {
      return await readExcelFile(target, { sheetName, startRow, maxRows, showFormulas });
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
  toArtifact: (args, result) => ({
    type: 'excel',
    path: result.path,
    sheet: result.sheet,
    rows: result.totalRows,
    cols: result.totalCols,
    columns: result.columns,
  }),
};

module.exports = readExcel;
module.exports.__test = { normalizeCell, sliceSheet, headerOf, MAX_COLS, TEXT_BUDGET, MAX_CELL_CHARS };
