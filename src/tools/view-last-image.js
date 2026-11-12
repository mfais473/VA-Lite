const { viewCurrent } = require('../image/image-view');

const viewLastImage = {
  name: 'view_last_image',
  description:
    'Melihat ulang gambar terakhir yang dilihat (dipilih pengguna lewat pick_source atau read_folder, atau screenshot lewat view_screenshot), TANPA membuka dialog lagi. ' +
    'Pakai saat pengguna minta revisi, koreksi, atau pengecekan hasil yang berasal dari gambar itu ' +
    '(mis. "baris 5 salah", "cek lagi tabelnya"), supaya kamu mencocokkan hasilmu dengan gambar aslinya ' +
    'dan tidak menebak dari ingatan.',
  params: {},
  permission: 'auto',
  untrusted: true,
  taintExempt: true,
  describe: () => 'Boleh aku melihat ulang gambar tadi?',
  execute: async () => viewCurrent(),
};

module.exports = viewLastImage;
