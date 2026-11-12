const { viewCurrent } = require('../image/image-view');

const adjustImage = {
  name: 'adjust_image',
  description:
    'Memutar, memotong, atau memperbesar bagian dari gambar terakhir yang dilihat (gambar pilihan pengguna atau screenshot), lalu melihat hasilnya. ' +
    'Pakai hanya jika anda merasa gambar miring/terbalik, atau kalau tabel/teks padat sulit terbaca: potong per bagian ' +
    '(mis. 0-55% bagian atas, lalu 45-100% bagian bawah, sedikit tumpang tindih) dan baca satu per satu. ' +
    'Pemotongan diambil dari gambar asli, jadi detailnya tetap tajam.',
  params: {
    rotate: {
      type: 'string',
      required: false,
      description:
        'Putaran searah jarum jam dari gambar ASLI: 0, 90, 180, 270, atau -90. Nilai absolut, bukan tambahan. ' +
        'Kosongkan untuk mempertahankan putaran saat ini.',
    },
    left: { type: 'string', required: false, description: 'Batas kiri area, persen 0-100 dari lebar gambar (default 0)' },
    top: { type: 'string', required: false, description: 'Batas atas area, persen 0-100 dari tinggi gambar (default 0)' },
    right: { type: 'string', required: false, description: 'Batas kanan area, persen 0-100 dari lebar gambar (default 100)' },
    bottom: { type: 'string', required: false, description: 'Batas bawah area, persen 0-100 dari tinggi gambar (default 100)' },
  },
  permission: 'auto',
  untrusted: true,
  taintExempt: true,
  describe: () => 'Boleh aku memutar atau memperbesar bagian gambar tadi?',
  execute: async ({ rotate, left, top, right, bottom }) =>
    viewCurrent({ rotation: rotate, region: { left, top, right, bottom } }),
};

module.exports = adjustImage;
