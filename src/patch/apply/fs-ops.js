const path = require('path');
const crypto = require('crypto');
const { IS_WIN } = require('../../shared/platform');
const { state } = require('./state');

function readCurrent(abs) {
  let lst;
  try {
    lst = state.fs.lstatSync(abs);
  } catch (err) {
    if (err.code === 'ENOENT') return { exists: false };
    throw err;
  }
  if (lst.isSymbolicLink() || !lst.isFile()) return { exists: true, weird: true };
  return { exists: true, buf: state.fs.readFileSync(abs) };
}

function mkdirTracked(dir, created) {
  const missing = [];
  let d = dir;
  while (!state.fs.existsSync(d)) {
    missing.push(d);
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  for (const m of missing.reverse()) {
    state.fs.mkdirSync(m);
    created.push(m);
  }
}

function writeTemp(abs, buf, mode) {
  const tmp = path.join(path.dirname(abs), `.via-tmp-${crypto.randomBytes(4).toString('hex')}`);
  const fd = state.fs.openSync(tmp, 'wx', mode || 0o644);
  try {
    state.fs.writeSync(fd, buf, 0, buf.length);
    try { state.fs.fsyncSync(fd); } catch {}
  } catch (err) {
    try { state.fs.closeSync(fd); } catch {}
    try { state.fs.unlinkSync(tmp); } catch {}
    throw err;
  }
  state.fs.closeSync(fd);
  if (!IS_WIN && mode) { try { state.fs.chmodSync(tmp, mode); } catch {} }
  return tmp;
}

function unlinkQuiet(p) {
  try { state.fs.unlinkSync(p); } catch {}
}

function restoreFile(w) {
  const created = [];
  mkdirTracked(path.dirname(w.abs), created);
  const tmp = writeTemp(w.abs, w.before.buf, w.mode);
  try {
    state.fs.renameSync(tmp, w.abs);
  } catch (err) {
    unlinkQuiet(tmp);
    throw err;
  }
}

module.exports = { readCurrent, mkdirTracked, writeTemp, unlinkQuiet, restoreFile };
