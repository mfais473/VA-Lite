const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

let backupDirOverride = null;

function setBackupDir(dir) { backupDirOverride = dir; }

function backupRoot() {
  if (backupDirOverride) return backupDirOverride;
  try {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'project-backups');
  } catch {
    return path.join(os.tmpdir(), 'via-project-backups');
  }
}

function backupBeforeWrite(abs, rel) {
  if (!fs.existsSync(abs)) return null;
  const stamp = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const dest = path.join(backupRoot(), stamp, ...rel.split('/'));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(abs, dest);
  return dest;
}

function writeFileAtomic(abs, content, mode) {
  const dir = path.dirname(abs);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.via-tmp-${crypto.randomBytes(4).toString('hex')}`);
  try {
    fs.writeFileSync(tmp, content, { encoding: 'utf8', mode: mode || 0o644 });
    fs.renameSync(tmp, abs);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch {}
    throw err;
  }
}

function looksBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

module.exports = { setBackupDir, backupBeforeWrite, writeFileAtomic, looksBinary };
