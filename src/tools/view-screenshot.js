const fs = require('fs/promises');
const { getLastScreenshotPath } = require('./state-screenshot');
const imageSession = require('../image/image-session');
const imageOps = require('../image/image-ops');

const viewScreenshot = {
  name: 'view_screenshot',
  description:
    'Melihat isi screenshot terakhir yang baru diambil agar kamu bisa menganalisis ' +
    'atau menjelaskan apa yang ada di dalamnya. Pakai HANYA saat pengguna minta ' +
    'analisis screenshot, tanya isinya, atau minta penjelasan tentang yang tampak.',
  params: {},
  permission: 'confirm',
  untrusted: true,
  describe: () =>
    'Boleh aku lihat screenshot terakhir? Gambarnya akan dikirim ke layanan AI untuk dianalisis.',
  toArtifact: (args, result) => ({ type: 'image', path: result.path }),
  execute: async () => {
    const p = getLastScreenshotPath();
    if (!p) return { success: false, error: 'Belum ada screenshot yang diambil' };
    try {
      const buffer = await fs.readFile(p);
      const out = imageOps.prepareForModel(buffer, 'image/png');
      imageSession.setSource({ path: p, buffer, mimeType: 'image/png' });
      return {
        success: true,
        path: p,
        imageBase64: out.buffer.toString('base64'),
        imageMimeType: out.mimeType,
        message: 'Screenshot berhasil dibaca',
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
};

module.exports = viewScreenshot;
