const path = require('path');
const { isInsideAllowed } = require('./path-guard');
const { getLatest } = require('./session-artifacts');
const picked = require('./picked-access');
const { DEFAULT_BLOCKS, MAX_PARA_CHARS, TEXT_BUDGET, renderBlock, sliceDocument } = require('./word/read-render');
const { readWordFile, MAX_BLOCKS_PER_CALL } = require('./word/read-core');

const readWord = {
  name: 'read_word',
  description:
    'Membaca isi file Word (.docx): setiap paragraf dan tabel menjadi satu \"blok\" bernomor [n] ' +
    '(judul ditandai H1/H2/Judul, butir daftar ditandai daftar, tabel sebagai JSON array of array). ' +
    'Nomor blok ini dipakai edit_word untuk menunjuk bagian yang diubah. Pakai saat pengguna ingin membahas, ' +
    'memeriksa, atau mengubah dokumen Word. Kalau pengguna menyebut \"dokumen tadi\"/\"file itu\", kosongkan ' +
    '\"path\": aplikasi memakai file Word terbaru di sesi ini. Kalau pengguna tidak menyebut path, pakai pick_source (kind word); file di folder pilihan pengguna boleh dibaca dengan path persis dari hasil tool. Dokumen panjang dibaca per halaman ' +
    '(startBlock/maxBlocks); cek \"complete\" dan \"nextStartBlock\". Header/footer, catatan kaki, dan kotak ' +
    'teks tidak ikut terbaca. Tanda ⇥ dan ⏎ hanya penanda tab dan baris baru.',
  params: {
    path: { type: 'string', required: false, description: 'Path lengkap file .docx (kosongkan untuk Word terbaru di sesi ini)' },
    startBlock: { type: 'string', required: false, description: 'Nomor blok awal, mulai dari 1 (default 1)' },
    maxBlocks: { type: 'string', required: false, description: `Jumlah blok maksimal (default ${DEFAULT_BLOCKS}, maks ${MAX_BLOCKS_PER_CALL})` },
  },
  permission: 'confirm',
  untrusted: true,
  describe: ({ path: p }) =>
    `Boleh aku baca isi file Word ${p ? path.basename(p) : 'tadi'}? Isinya akan dikirim ke layanan AI.`,
  execute: async ({ path: filePath, startBlock, maxBlocks }) => {
    let target = filePath;
    if (!target) {
      const latest = getLatest('word');
      if (!latest) return { success: false, error: 'Path kosong dan belum ada file Word di sesi ini' };
      target = latest.path;
    }
    const lower = target.toLowerCase();
    if (lower.endsWith('.doc')) return { success: false, error: 'Format .doc lama tidak didukung. Simpan ulang sebagai .docx dulu' };
    if (!lower.endsWith('.docx')) return { success: false, error: 'Hanya file .docx yang didukung' };
    if (!isInsideAllowed(target) && !picked.isGranted(target)) return { success: false, error: 'File di luar area yang diizinkan' };
    try {
      return await readWordFile(target, { startBlock, maxBlocks });
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
  historyNote: (args, result) => (result && result.success
    ? `dibaca blok ${result.startBlock}-${result.startBlock + result.returnedBlocks - 1} dari ${result.totalBlocks}${result.complete ? ' (lengkap)' : ' (belum lengkap)'}`
    : ''),
  toArtifact: (args, result) => ({
    type: 'word',
    path: result.path,
    blocks: result.totalBlocks,
    headings: (result.outline || []).map((h) => h.text),
  }),
};

module.exports = readWord;
module.exports.__test = { renderBlock, sliceDocument, MAX_PARA_CHARS, TEXT_BUDGET };
