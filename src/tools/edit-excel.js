const path = require('path');
const fs = require('fs/promises');
const { isInsideAllowed } = require('./path-guard');
const { getLatest } = require('./session-artifacts');
const { uniquePath, writeFileAtomic } = require('./file-utils');
const { MAX_BYTES, MAX_OPERATIONS, MAX_CELLS } = require('./excel/limits');
const { parseAddress, parseRange } = require('./excel/address');
const { checkValue } = require('./excel/values');
const { planOperations, summarize } = require('./excel/plan');
const { countFormulas, applyOperations } = require('./excel/apply');
const { fidelityIssues, headerOf } = require('./excel/inspect');

function resolveTarget(p) {
  if (p) return { target: p };
  const latest = getLatest('excel');
  return latest ? { target: latest.path } : { error: 'Path kosong dan belum ada file Excel di sesi ini' };
}

const editExcel = {
  name: 'edit_excel',
  description:
    'Mengubah file Excel (.xlsx) yang SUDAH ada lewat satu daftar operasi JSON: set_cell, set_range, ' +
    'append_rows, insert_rows, delete_rows, clear_range, add_sheet, rename_sheet, delete_sheet. ' +
    'Rumus, format, dan lebar kolom asli dipertahankan (beda dengan membuat ulang lewat create_excel). ' +
    'Panggil read_excel dulu untuk melihat isi dan alamat sel yang benar; jangan menebak alamat. ' +
    'Semua operasi diperiksa dan dijalankan di memori; kalau satu gagal, tidak ada yang ditulis. ' +
    'Teks yang diawali \"=\" ditulis sebagai rumus (mis. \"=SUM(B2:B10)\"). Angka tulis sebagai angka. ' +
    'Nomor baris di operasi berikutnya mengikuti kondisi SETELAH operasi sebelumnya. ' +
    'insert_rows/delete_rows ditolak bila file berisi rumus (rujukan rumus tidak ikut bergeser). ' +
    'Default: hasil disimpan sebagai SALINAN baru (nama-edit.xlsx) dan file asli tidak berubah; ' +
    'saveMode=overwrite menimpa file asli (cadangan dibuat otomatis) dan hanya dipakai bila pengguna minta. ' +
    'File berisi grafik/pivot tidak boleh ditimpa karena fitur itu tidak terbawa. ' +
    `Batas: ${MAX_OPERATIONS} operasi dan ${MAX_CELLS} sel per panggilan.`,
  params: {
    path: { type: 'string', required: false, description: 'Path lengkap file .xlsx (kosongkan untuk Excel terbaru di sesi ini)' },
    operations: {
      type: 'string', required: true, raw: true,
      description:
        'Array JSON operasi. Contoh: [{\"op\":\"set_cell\",\"sheet\":\"Sheet1\",\"cell\":\"C2\",\"value\":90},' +
        '{\"op\":\"set_range\",\"start\":\"A5\",\"values\":[[\"Dewi\",88]]},{\"op\":\"append_rows\",\"rows\":[[\"Rani\",75]]},' +
        '{\"op\":\"insert_rows\",\"at\":3,\"count\":1},{\"op\":\"delete_rows\",\"at\":7,\"count\":2},' +
        '{\"op\":\"clear_range\",\"range\":\"D2:D9\"},{\"op\":\"add_sheet\",\"name\":\"Rekap\",\"rows\":[[\"A\",\"B\"]]},' +
        '{\"op\":\"rename_sheet\",\"from\":\"Sheet1\",\"to\":\"Data\"},{\"op\":\"delete_sheet\",\"name\":\"Lama\"}]. ' +
        '\"sheet\" opsional (default sheet pertama).',
    },
    saveMode: { type: 'string', required: false, description: '\"copy\" (default, simpan salinan baru) atau \"overwrite\" (timpa file asli, cadangan otomatis)' },
  },
  permission: 'confirm',
  alwaysConfirm: true,
  untrusted: false,
  describe: ({ path: p, operations, saveMode }) => {
    const { target } = resolveTarget(p);
    const name = target ? path.basename(target) : 'Excel tadi';
    const plan = planOperations(operations);
    if (!plan.ok) return `Boleh aku mengubah file Excel ${name}?`;
    const overwrite = String(saveMode || '').toLowerCase() === 'overwrite';
    const warn = plan.destructive.length ? `PERHATIAN, ini ${plan.destructive.slice(0, 3).join(', ')}. ` : '';
    const where = overwrite
      ? 'Hasilnya MENIMPA file aslinya (cadangan dibuat otomatis)'
      : 'Hasilnya disimpan sebagai salinan baru, file asli tidak berubah';
    return `${warn}Boleh aku mengubah file Excel ${name}: ${summarize(plan.summary)}? ${where}.`;
  },
  validate: ({ path: p, operations, saveMode }) => {
    if (p && !p.toLowerCase().endsWith('.xlsx')) return 'Hanya file .xlsx yang didukung';
    if (saveMode && !['copy', 'overwrite'].includes(String(saveMode).toLowerCase())) {
      return 'saveMode harus \"copy\" atau \"overwrite\"';
    }
    const plan = planOperations(operations);
    return plan.ok ? null : plan.error;
  },
  execute: async ({ path: filePath, operations, saveMode }) => {
    const resolved = resolveTarget(filePath);
    if (resolved.error) return { success: false, error: resolved.error };
    const target = resolved.target;
    if (!target.toLowerCase().endsWith('.xlsx')) return { success: false, error: 'Hanya file .xlsx yang didukung' };
    if (!isInsideAllowed(target)) return { success: false, error: 'File di luar area yang diizinkan' };
    const plan = planOperations(operations);
    if (!plan.ok) return { success: false, error: plan.error };
    const overwrite = String(saveMode || 'copy').toLowerCase() === 'overwrite';

    try {
      const stat = await fs.stat(target);
      if (!stat.isFile()) return { success: false, error: 'Path bukan file' };
      if (stat.size > MAX_BYTES) return { success: false, error: 'File Excel terlalu besar (maks 20 MB)' };
      const buffer = await fs.readFile(target);

      const issues = await fidelityIssues(buffer);
      if (overwrite && issues.length) {
        return {
          success: false,
          error: `File berisi ${issues.join(', ')} yang akan hilang bila disimpan ulang, jadi tidak boleh ditimpa. ` +
            'Gunakan saveMode=copy (salinan baru) atau ubah manual di Excel.',
        };
      }

      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      if (!wb.worksheets.length) return { success: false, error: 'File Excel tidak punya sheet' };

      if (plan.structural) {
        const formulas = countFormulas(wb);
        if (formulas > 0) {
          return {
            success: false,
            error: `File berisi ${formulas} sel berumus. insert_rows/delete_rows tidak menggeser rujukan rumus, jadi ` +
              'hasilnya bisa salah diam-diam dan operasi dibatalkan. Pakai set_range/append_rows/clear_range, atau ubah baris manual di Excel.',
          };
        }
      }

      let applied;
      try {
        applied = applyOperations(wb, plan.ops);
      } catch (err) {
        return { success: false, error: `${err.message}. Tidak ada yang ditulis.` };
      }

      const out = await wb.xlsx.writeBuffer();
      const dir = path.dirname(target);
      const { name: base, ext } = path.parse(target);
      let outPath;
      let backupPath;
      if (overwrite) {
        backupPath = await uniquePath(path.join(dir, `${base}-cadangan${ext}`));
        if (!backupPath) return { success: false, error: 'Tidak bisa menentukan nama file cadangan' };
        await fs.copyFile(target, backupPath);
        await writeFileAtomic(target, Buffer.from(out));
        outPath = target;
      } else {
        outPath = await uniquePath(path.join(dir, `${base}-edit${ext}`));
        if (!outPath) return { success: false, error: 'Tidak bisa menentukan nama file unik' };
        await fs.writeFile(outPath, Buffer.from(out));
      }

      const ws = applied.lastSheet && wb.worksheets.includes(applied.lastSheet) ? applied.lastSheet : wb.worksheets[0];
      const warnings = [];
      if (issues.length) warnings.push(`File asli berisi ${issues.join(', ')} yang tidak ikut tersimpan di salinan ini.`);
      if (plan.ops.some((o) => o.op === 'set_cell' || o.op === 'set_range' || o.op === 'append_rows')) {
        warnings.push('Nilai rumus yang baru ditulis akan dihitung saat file dibuka di Excel.');
      }
      return {
        success: true,
        path: outPath,
        sourcePath: target,
        mode: overwrite ? 'overwrite' : 'copy',
        ...(backupPath ? { backupPath } : {}),
        operations: plan.ops.length,
        changes: plan.summary,
        sheet: ws.name,
        sheets: wb.worksheets.map((w) => w.name),
        totalRows: ws.rowCount,
        totalCols: ws.columnCount,
        columns: headerOf(ws),
        ...(warnings.length ? { warnings } : {}),
        message: overwrite
          ? `File ${target} diperbarui (cadangan: ${backupPath})`
          : `Perubahan disimpan sebagai salinan baru di ${outPath}; file asli tidak diubah`,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
  historyNote: (args, result) => (result && result.success
    ? `perubahan: ${JSON.stringify(result.changes)}; sumber: ${result.sourcePath}; mode: ${result.mode}`
    : ''),
  toArtifact: (args, result) => ({
    type: 'excel',
    path: result.path,
    sheet: result.sheet,
    rows: result.totalRows,
    cols: result.totalCols,
    columns: result.columns,
  }),
};

module.exports = editExcel;
module.exports.__test = {
  parseAddress, parseRange, checkValue, planOperations, applyOperations, countFormulas,
  fidelityIssues, summarize, MAX_OPERATIONS, MAX_CELLS,
};
