'use strict';

const GROUPS = [
  {
    id: 'steps',
    label: 'Langkah & coding',
    description: 'Berapa banyak langkah tool-call yang boleh dipakai agen per permintaan, dan ukuran hasil baca file.',
  },
  {
    id: 'rate',
    label: 'Limit & retry',
    description: 'Perilaku saat penyedia API membatasi pemakaian (HTTP 429) atau sedang terganggu (503/504).',
  },
  {
    id: 'access',
    label: 'Akses & izin alat',
    description: 'Folder yang boleh disentuh alat dan alat yang boleh jalan tanpa konfirmasi.',
  },
  {
    id: 'display',
    label: 'Tampilan & debug',
    description: 'Opsi untuk pengembangan dan pemecahan masalah.',
  },
];

const PARAMS = [
  {
    key: 'VIA_MAX_AGENT_STEPS', group: 'steps', type: 'int', min: 1, max: 50, default: '6',
    label: 'Langkah maksimum (di luar mode coding)',
    hint: 'Batas langkah tool-call per permintaan. Naikkan (mis. 10) bila alur gambar yang memotong per bagian sering kehabisan langkah.',
  },
  {
    key: 'VIA_MAX_CODING_STEPS', group: 'steps', type: 'int', min: 1, max: 200, default: '24',
    label: 'Langkah maksimum mode coding',
    hint: 'Batas langkah tool-call per permintaan saat tool project_* dipakai.',
  },
  {
    key: 'VIA_READ_MAX_CHARS', group: 'steps', type: 'int', min: 2000, max: 60000, default: '12000',
    label: 'Batas karakter baca file proyek',
    hint: 'Batas karakter hasil project_read_file per panggilan. Makin kecil makin hemat token per langkah, tetapi file besar butuh lebih banyak panggilan baca.',
  },
  {
    key: 'VIA_PLAN_TTL_MIN', group: 'steps', type: 'int', min: 1, max: 240, default: '10', unit: 'menit',
    label: 'Masa berlaku rencana yang disetujui',
    hint: 'Setelah lewat, rencana coding yang sudah disetujui harus diajukan ulang.',
  },

  {
    key: 'VIA_RATE_RETRY_MAX', group: 'rate', type: 'int', min: 0, max: 10, default: '3',
    label: 'Maks percobaan ulang saat kena limit (429)',
    hint: '0 = tanpa retry. Via menunggu sesuai petunjuk penyedia (retry-after / retryDelay) sebelum mengulang.',
  },
  {
    key: 'VIA_RATE_RETRY_MAX_WAIT_MS', group: 'rate', type: 'int', min: 0, max: 3600000, default: '120000', unit: 'ms',
    label: 'Batas tunggu terlama',
    hint: 'Bila penyedia meminta menunggu lebih lama dari ini, dianggap kuota habis dan tidak di-retry.',
  },
  {
    key: 'VIA_RATE_RETRY_DEFAULT_WAIT_MS', group: 'rate', type: 'int', min: 0, max: 3600000, default: '60000', unit: 'ms',
    label: 'Waktu tunggu bila penyedia tidak memberi petunjuk',
    hint: 'Satu jendela menit adalah 60000 ms.',
  },
  {
    key: 'VIA_TRANSIENT_RETRY_MAX', group: 'rate', type: 'int', min: 0, max: 10, default: '3',
    label: 'Maks percobaan ulang gangguan sesaat (503/504)',
    hint: '0 = mati. Jeda bertingkat 1, 2, 4 detik (atau sesuai retry-after).',
  },
  {
    key: 'VIA_TRANSIENT_RETRY_STATUSES', group: 'rate', type: 'statuses', default: '503,504',
    label: 'Kode status yang diulang',
    hint: 'Pisahkan dengan koma, kode 500-599. Isi 503 saja bila 504 pada keluaran panjang terlihat dihitung dua kali oleh penyedia.',
  },
  {
    key: 'VIA_TPM_LIMIT', group: 'rate', type: 'int', min: 0, max: 1000000000, default: '', defaultLabel: 'mati', unit: 'token/menit',
    label: 'Batas token per menit (peringatan)',
    hint: 'Bila diisi, log [usage] memberi PERINGATAN saat pemakaian 60 detik terakhir melewati 80% batas ini. Hanya peringatan: tidak menunda atau menolak apa pun. Bila penyedia mengirim batasnya lewat header, angka header itulah yang dipakai.',
  },

  {
    key: 'VIA_ALLOWED_DIRS', group: 'access', type: 'dirs', default: '', defaultLabel: 'folder home',
    label: 'Folder yang boleh diakses alat',
    hint: 'Satu folder per baris (path lengkap). Kosong = folder home. Mencakup baca, cari, dan tulis oleh alat.',
  },
  {
    key: 'VIA_AUTO_TOOLS', group: 'access', type: 'tools', default: '', defaultLabel: 'tidak ada',
    label: 'Alat yang jalan tanpa konfirmasi',
    hint: 'Nama alat dipisah koma, mis. open_browser. Alat yang selalu butuh konfirmasi (edit/tulis/patch) tidak bisa dimasukkan, dan konfirmasi setelah membaca isi PDF/gambar tetap wajib.',
  },

  {
    key: 'VIA_DEVTOOLS', group: 'display', type: 'bool', default: '', defaultLabel: 'mati', restart: true,
    label: 'Buka DevTools terpisah saat debugging',
    hint: 'Berlaku setelah Via dijalankan ulang.',
  },
];

const PARAM_KEYS = PARAMS.map((p) => p.key);

module.exports = { GROUPS, PARAMS, PARAM_KEYS };
