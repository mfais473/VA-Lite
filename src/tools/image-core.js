const fs = require('fs/promises');
const path = require('path');
const imageSession = require('../image/image-session');
const imageOps = require('../image/image-ops');

const MAX_INPUT_BYTES = 30 * 1024 * 1024;
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif',
};

async function loadImageFile(filePath, { setSession = true } = {}) {
  const mimeType = MIME[path.extname(filePath).toLowerCase()];
  if (!mimeType) return { success: false, error: 'Format gambar tidak didukung' };
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return { success: false, error: 'Path bukan file' };
    if (stat.size > MAX_INPUT_BYTES) return { success: false, error: 'Gambar terlalu besar (maks 30 MB)' };
    const raw = await fs.readFile(filePath);
    const out = imageOps.prepareForModel(raw, mimeType);
    if (setSession) imageSession.setSource({ path: filePath, buffer: raw, mimeType });
    const size = imageOps.getSize(raw);
    return {
      success: true,
      path: filePath,
      ...(size ? { width: size.width, height: size.height } : {}),
      imageBase64: out.buffer.toString('base64'),
      imageMimeType: out.mimeType,
      message: 'Gambar berhasil dibaca',
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { loadImageFile, MIME, MAX_INPUT_BYTES };
