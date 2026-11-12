const path = require('path');
const fs = require('fs/promises');

function safeName(name, fallbackBase = 'berkas', ext = '') {
  const base = path.basename(String(name || '')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
  return base || `${fallbackBase}-${Date.now()}${ext}`;
}

function withExt(name, ext) {
  return name.toLowerCase().endsWith(ext) ? name : name + ext;
}

async function uniquePath(p) {
  const { dir, name, ext } = path.parse(p);
  let candidate = p;
  for (let i = 1; i < 1000; i++) {
    try {
      await fs.access(candidate);
      candidate = path.join(dir, `${name}-${i}${ext}`);
    } catch {
      return candidate;
    }
  }
  return null;
}

async function writeFileAtomic(target, data) {
  const tmp = `${target}.via-tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    if (err && (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES')) {
      throw new Error('File tidak bisa ditimpa (mungkin sedang terbuka di Word/Excel). Tutup dulu, lalu coba lagi.');
    }
    throw err;
  }
}

function toInt(v, def, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
}

module.exports = { safeName, withExt, uniquePath, writeFileAtomic, toInt };
