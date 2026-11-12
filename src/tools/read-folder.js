const path = require('path');
const { isInsideAllowed } = require('./path-guard');
const picked = require('./picked-access');
const { scanFolder, isKind, KINDS } = require('./folder-scan');
const { toInt } = require('./file-utils');
const { readExcelOverview } = require('./excel/read-core');
const { readWordFile } = require('./word/read-core');
const { loadImageFile } = require('./image-core');
const pdfCore = require('./pdf-core');

const BATCH_CHARS = 30000;
const DEFAULTS = { excel: 10, word: 8, pdf: 8, image: 4 };
const MAX_PER_CALL = { excel: 25, word: 15, pdf: 15, image: 4 };

function excelBlock(r) {
  return r.sheets.map((s) => (s.skipped
    ? `--- sheet "${s.sheet}" (${s.totalRows} baris x ${s.totalCols} kolom, DILEWATI karena batas teks) ---`
    : `--- sheet "${s.sheet}" (${s.totalRows} baris x ${s.totalCols} kolom, dibaca ${s.returnedRows} baris${s.complete ? ', lengkap' : ', BELUM lengkap'}) ---\n${JSON.stringify(s.rows)}`)
  ).join('\n');
}

const readFolder = {
  name: 'read_folder',
  description:
    'Membaca SEKALIGUS banyak file Excel (.xlsx), Word (.docx), PDF, atau gambar dari satu folder (termasuk subfolder, sampai kedalaman 4). ' +
    'Pakai setelah pengguna memilih folder lewat pick_source, atau saat ia menyebut folder tertentu. Hasil dibaca bertahap: ' +
    'cek "complete" dan "nextIndex", lalu lanjutkan dengan startIndex = nextIndex sampai semua file terbaca; jangan menyimpulkan ' +
    'file yang belum dibaca. Excel dibaca berupa ringkasan per sheet (baris awal); Word dari blok awal; PDF dari halaman awal; gambar maksimal 4 per panggilan. ' +
    'Kalau butuh isi lengkap satu file, pakai read_excel / read_word / read_pdf dengan path file itu.',
  params: {
    kind: { type: 'string', required: true, description: 'excel | word | pdf | image' },
    folder: { type: 'string', required: false, description: 'Path folder persis (kosongkan untuk folder terakhir yang dipilih pengguna)' },
    startIndex: { type: 'string', required: false, description: 'Nomor file awal, mulai dari 1 (default 1)' },
    maxFiles: { type: 'string', required: false, description: 'Jumlah file maksimal per panggilan (ada batas otomatis per jenis)' },
  },
  permission: 'confirm',
  untrusted: true,
  describe: ({ kind, folder }) => {
    const label = isKind(kind) ? KINDS[kind].label : 'berkas';
    return `Boleh aku baca semua file ${label} di folder ${folder ? path.basename(folder) : 'yang tadi dipilih'}? Isinya akan dikirim ke layanan AI.`;
  },
  validate: ({ kind }) => (isKind(kind) && kind in DEFAULTS ? null : 'kind harus salah satu dari: excel, word, pdf, image'),
  historyNote: (args, result) => (result && result.success
    ? `file ${result.startIndex}-${result.endIndex} dari ${result.totalFiles}` +
      (result.nextIndex ? `; belum dibaca mulai nomor ${result.nextIndex}` : '; semua file di folder sudah dibaca')
    : ''),
  execute: async ({ kind, folder, startIndex, maxFiles }) => {
    if (!isKind(kind)) return { success: false, error: 'kind harus salah satu dari: excel, word, pdf, image' };
    let dir = folder;
    if (!dir) {
      dir = picked.latestFolder();
      if (!dir) return { success: false, error: 'Belum ada folder yang dipilih. Panggil pick_source dulu agar pengguna memilih folder.' };
    }
    if (!picked.isGranted(dir) && !isInsideAllowed(dir)) {
      return { success: false, error: 'Folder di luar area yang diizinkan. Minta pengguna memilihnya lewat pick_source.' };
    }
    const scan = scanFolder(dir, kind);
    if (scan.error) return { success: false, error: scan.error };
    const total = scan.files.length;
    if (!total) return { success: false, error: `Tidak ada file ${KINDS[kind].label} di folder ini` };

    const start = toInt(startIndex, 1, 1, 1000000);
    if (start > total) return { success: false, error: `startIndex ${start} melebihi jumlah file (${total})` };
    const limit = toInt(maxFiles, DEFAULTS[kind], 1, MAX_PER_CALL[kind]);

    const blocks = [];
    const images = [];
    const summary = [];
    let used = 0;
    let index = start;
    let allFull = true;
    let lastImage = null;

    while (index <= total && index < start + limit) {
      const f = scan.files[index - 1];
      if (kind !== 'image' && summary.length && used >= BATCH_CHARS) break;
      const remaining = Math.max(BATCH_CHARS - used, 1500);
      let entry;
      try {
        if (kind === 'excel') {
          const r = await readExcelOverview(f.abs, { charBudget: Math.min(6000, remaining) });
          if (r.success) {
            const text = excelBlock(r);
            used += text.length;
            if (!r.complete) allFull = false;
            blocks.push(`=== [${index}/${total}] ${f.rel} ===\n${text}`);
            entry = { index, file: f.rel, complete: r.complete };
          } else entry = { index, file: f.rel, error: r.error };
        } else if (kind === 'word') {
          const r = await readWordFile(f.abs, { maxBlocks: 80 });
          if (r.success) {
            const text = r.text.length > remaining ? `${r.text.slice(0, remaining)}\n...(dipotong)` : r.text;
            used += text.length;
            const full = r.complete && text === r.text;
            if (!full) allFull = false;
            blocks.push(`=== [${index}/${total}] ${f.rel} (${r.totalBlocks} blok${full ? ', lengkap' : `, BELUM lengkap: baru blok ${r.startBlock}-${r.startBlock + r.returnedBlocks - 1}`}) ===\n${text}`);
            entry = { index, file: f.rel, blocks: r.totalBlocks, complete: full };
          } else entry = { index, file: f.rel, error: r.error };
        } else if (kind === 'pdf') {
          const r = await pdfCore.readPdfFile(f.abs);
          if (r.success) {
            const text = r.text.length > remaining ? `${r.text.slice(0, remaining)}\n...(dipotong)` : r.text;
            used += text.length;
            const full = r.complete && text === r.text;
            if (!full) allFull = false;
            blocks.push(`=== [${index}/${total}] ${f.rel} (${r.pages} halaman${full ? ', lengkap' : `, BELUM lengkap: baru halaman ${r.startPage}-${r.endPage}`}) ===\n${text}`);
            entry = { index, file: f.rel, pages: r.pages, complete: full, ...(r.note ? { note: r.note } : {}) };
          } else entry = { index, file: f.rel, error: r.error };
        } else {
          const r = await loadImageFile(f.abs, { setSession: false });
          if (r.success) {
            images.push({ name: f.rel, mimeType: r.imageMimeType, data: r.imageBase64 });
            lastImage = f.abs;
            blocks.push(`=== [${index}/${total}] ${f.rel} === (gambar terlampir sebagai gambar ke-${images.length} pada pesan berikutnya)`);
            entry = { index, file: f.rel };
          } else entry = { index, file: f.rel, error: r.error };
        }
      } catch (err) {
        entry = { index, file: f.rel, error: err.message };
      }
      if (entry.error) {
        allFull = false;
        blocks.push(`=== [${index}/${total}] ${f.rel} === GAGAL: ${entry.error}`);
      }
      summary.push(entry);
      index += 1;
    }

    const endIndex = index - 1;
    const nextIndex = endIndex < total ? endIndex + 1 : null;
    const complete = start === 1 && !nextIndex && allFull;
    const notes = [];
    if (nextIndex) notes.push(`BELUM semua file terbaca (baru ${start}-${endIndex} dari ${total}). Lanjutkan dengan read_folder startIndex=${nextIndex}.`);
    if (!allFull) notes.push('Sebagian isi dipotong atau gagal dibaca; untuk isi lengkap satu file pakai read_excel / read_word / read_pdf dengan path-nya. Jangan menyimpulkan bagian yang belum terbaca.');
    if (scan.capped) notes.push('Pemindaian folder dibatasi; mungkin ada file lain yang tidak terdaftar.');
    if (lastImage) {
      const imageSession = require('../image/image-session');
      const fs = require('fs');
      try {
        const raw = fs.readFileSync(lastImage);
        const ext = path.extname(lastImage).toLowerCase();
        const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
        imageSession.setSource({ path: lastImage, buffer: raw, mimeType: mime });
        notes.push('view_last_image bekerja pada gambar TERAKHIR di batch ini.');
      } catch {
      }
    }

    return {
      success: true,
      kind,
      folder: scan.root,
      totalFiles: total,
      startIndex: start,
      endIndex,
      nextIndex,
      complete,
      files: summary,
      ...(notes.length ? { note: notes.join(' ') } : {}),
      ...(images.length ? { images } : {}),
      text: blocks.join('\n\n'),
    };
  },
};

module.exports = readFolder;
