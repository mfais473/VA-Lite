const path = require('path');
const { isInsideAllowed } = require('./path-guard');
const { getLatest } = require('./session-artifacts');
const picked = require('./picked-access');
const pdfCore = require('./pdf-core');

const readPdf = {
  name: 'read_pdf',
  description:
    'Membaca isi dokumen PDF dari path lengkap dan mengembalikan teksnya per halaman. ' +
    'Pakai kalau pengguna menyebut path lengkap, misalnya ' +
    '"C:\\\\Users\\\\Me\\\\Documents\\\\laporan.pdf", atau untuk satu file di folder yang sudah dipilih pengguna. ' +
    'Kalau pengguna hanya bilang "baca PDF ini" tanpa path, pakai pick_source (kind pdf). PDF panjang dibaca bertahap: cek "complete" ' +
    'dan "nextStartPage" di hasil, lalu lanjutkan dengan startPage (path boleh dikosongkan untuk PDF terakhir di sesi ini).',
  params: {
    path: { type: 'string', required: false, description: 'Path lengkap file .pdf (kosongkan untuk PDF terakhir di sesi ini)' },
    startPage: { type: 'string', required: false, description: 'Halaman awal, mulai dari 1 (default 1)' },
    endPage: { type: 'string', required: false, description: 'Halaman akhir (default: sampai batas teks per panggilan)' },
  },
  permission: 'confirm',
  untrusted: true,
  describe: ({ path: p }) =>
    `Boleh aku baca isi file ${p ? path.basename(p) : 'PDF tadi'}? Isinya akan dikirim ke layanan AI.`,
  historyNote: pdfCore.historyNote,
  toArtifact: (args, result) => ({ type: 'pdf', path: result.path, pages: result.pages }),
  execute: async ({ path: filePath, startPage, endPage }) => {
    let target = filePath;
    if (!target) {
      const latest = getLatest('pdf');
      if (!latest) return { success: false, error: 'Path kosong dan belum ada PDF di sesi ini' };
      target = latest.path;
    }
    if (!target.toLowerCase().endsWith('.pdf')) {
      return { success: false, error: 'Hanya file .pdf yang didukung' };
    }
    if (!isInsideAllowed(target) && !picked.isGranted(target)) {
      return { success: false, error: 'File di luar area yang diizinkan' };
    }
    try {
      return await pdfCore.readPdfFile(target, { startPage, endPage });
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
};

module.exports = readPdf;
