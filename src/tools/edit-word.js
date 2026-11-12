const path = require('path');
const fs = require('fs/promises');
const { isInsideAllowed } = require('./path-guard');
const { getLatest } = require('./session-artifacts');
const { uniquePath, writeFileAtomic } = require('./file-utils');
const core = require('./docx-core');
const { MAX_OPERATIONS, planOperations, summarizePlan } = require('./word/edit-plan');

const MAX_BYTES = 20 * 1024 * 1024;

function resolveTarget(p) {
  if (p) return { target: p };
  const latest = getLatest('word');
  return latest ? { target: latest.path } : { error: 'Path kosong dan belum ada file Word di sesi ini' };
}

const editWord = {
  name: 'edit_word',
  description:
    'Mengubah file Word (.docx) yang SUDAH ada lewat satu daftar operasi JSON. Gaya, penomoran, gambar, ' +
    'header/footer, dan format lain di luar bagian yang diubah tetap utuh (beda dengan membuat ulang lewat create_word). ' +
    'Panggil read_word dulu; nomor blok dan teks yang kamu pakai harus persis dari hasil baca. ' +
    'Operasi: replace_text {find,replace,block?,replaceAll?,matchCase?} (find harus unik kecuali replaceAll=true; ' +
    'tetap ketemu walau terpecah di beberapa format), set_paragraph {block,text} (menimpa seluruh isi satu paragraf), ' +
    'insert_paragraph {after,text,style?} (after=0 untuk di awal), append_paragraph {text,style?}, delete_block {block}, ' +
    'set_table_cell {block,row,col,text}, append_table_row {block,cells}, delete_table_row {block,row}. ' +
    'style: normal, title, heading1..heading6. Semua nomor blok/baris/kolom mulai dari 1 dan merujuk dokumen ' +
    'SEBELUM patch ini, jadi urutan operasi tidak menggeser nomor. Semua operasi dijalankan di memori; kalau satu ' +
    'gagal, tidak ada yang ditulis. set_paragraph ditolak untuk paragraf berisi gambar/field; pakai replace_text. ' +
    'Perubahan ditulis langsung (bukan tracked changes). Default: hasil disimpan sebagai SALINAN baru (nama-edit.docx), ' +
    'file asli tidak berubah; saveMode=overwrite menimpa file asli (cadangan otomatis) dan hanya dipakai bila pengguna minta. ' +
    `Batas: ${MAX_OPERATIONS} operasi per panggilan.`,
  params: {
    path: { type: 'string', required: false, description: 'Path lengkap file .docx (kosongkan untuk Word terbaru di sesi ini)' },
    operations: {
      type: 'string', required: true, raw: true,
      description:
        'Array JSON operasi. Contoh: [{\"op\":\"replace_text\",\"find\":\"Jember\",\"replace\":\"Surabaya\",\"replaceAll\":true},' +
        '{\"op\":\"set_paragraph\",\"block\":4,\"text\":\"Paragraf baru.\"},' +
        '{\"op\":\"insert_paragraph\",\"after\":4,\"text\":\"Bab Baru\",\"style\":\"heading1\"},' +
        '{\"op\":\"set_table_cell\",\"block\":7,\"row\":2,\"col\":2,\"text\":\"90\"},' +
        '{\"op\":\"append_table_row\",\"block\":7,\"cells\":[\"Rani\",\"75\"]},{\"op\":\"delete_block\",\"block\":9}]',
    },
    saveMode: { type: 'string', required: false, description: '\"copy\" (default, simpan salinan baru) atau \"overwrite\" (timpa file asli, cadangan otomatis)' },
  },
  permission: 'confirm',
  alwaysConfirm: true,
  untrusted: false,
  describe: ({ path: p, operations, saveMode }) => {
    const { target } = resolveTarget(p);
    const name = target ? path.basename(target) : 'Word tadi';
    const plan = planOperations(operations);
    if (!plan.ok) return `Boleh aku mengubah file Word ${name}?`;
    const overwrite = String(saveMode || '').toLowerCase() === 'overwrite';
    const warn = plan.destructive.length ? `PERHATIAN, ini ${plan.destructive.slice(0, 3).join(', ')}. ` : '';
    const where = overwrite
      ? 'Hasilnya MENIMPA file aslinya (cadangan dibuat otomatis)'
      : 'Hasilnya disimpan sebagai salinan baru, file asli tidak berubah';
    return `${warn}Boleh aku mengubah file Word ${name}: ${summarizePlan(plan.summary)}? ${where}.`;
  },
  validate: ({ path: p, operations, saveMode }) => {
    if (p && !p.toLowerCase().endsWith('.docx')) return 'Hanya file .docx yang didukung';
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
    if (!target.toLowerCase().endsWith('.docx')) return { success: false, error: 'Hanya file .docx yang didukung' };
    if (!isInsideAllowed(target)) return { success: false, error: 'File di luar area yang diizinkan' };
    const plan = planOperations(operations);
    if (!plan.ok) return { success: false, error: plan.error };
    const overwrite = String(saveMode || 'copy').toLowerCase() === 'overwrite';

    try {
      const stat = await fs.stat(target);
      if (!stat.isFile()) return { success: false, error: 'Path bukan file' };
      if (stat.size > MAX_BYTES) return { success: false, error: 'File Word terlalu besar (maks 20 MB)' };
      const opened = await core.openDocx(await fs.readFile(target));
      const ed = await core.createEditor(opened);

      for (let i = 0; i < plan.ops.length; i++) {
        try {
          core.applyOp(ed, plan.ops[i]);
        } catch (err) {
          return { success: false, error: `Operasi #${i + 1} (${plan.ops[i].op}): ${err.message}. Tidak ada yang ditulis.` };
        }
      }

      const out = await core.saveDocx(opened);
      const info = core.summarize(await core.openDocx(out));

      const dir = path.dirname(target);
      const { name: base, ext } = path.parse(target);
      let outPath;
      let backupPath;
      if (overwrite) {
        backupPath = await uniquePath(path.join(dir, `${base}-cadangan${ext}`));
        if (!backupPath) return { success: false, error: 'Tidak bisa menentukan nama file cadangan' };
        await fs.copyFile(target, backupPath);
        await writeFileAtomic(target, out);
        outPath = target;
      } else {
        outPath = await uniquePath(path.join(dir, `${base}-edit${ext}`));
        if (!outPath) return { success: false, error: 'Tidak bisa menentukan nama file unik' };
        await fs.writeFile(outPath, out);
      }

      const warnings = Array.from(new Set(ed.warnings));
      if (info.features.trackedChanges) warnings.push('Dokumen memuat tracked changes; perubahan ini ditulis langsung tanpa dilacak.');
      return {
        success: true,
        path: outPath,
        sourcePath: target,
        mode: overwrite ? 'overwrite' : 'copy',
        ...(backupPath ? { backupPath } : {}),
        operations: plan.ops.length,
        changes: ed.stats,
        totalBlocks: info.blocks,
        outline: info.headings.slice(0, 20).map((h) => ({ n: h.n, level: h.level, text: h.text.slice(0, 80) })),
        note: 'Nomor blok di dokumen hasil bisa bergeser dari sebelumnya; panggil read_word lagi sebelum edit berikutnya.',
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
    type: 'word',
    path: result.path,
    blocks: result.totalBlocks,
    headings: (result.outline || []).map((h) => h.text),
  }),
};

module.exports = editWord;
module.exports.__test = { planOperations, summarizePlan, MAX_OPERATIONS };
