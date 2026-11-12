const { sha256 } = require('../plan/identity');
const { state, lastBatchByPath } = require('./state');
const { readCurrent, restoreFile } = require('./fs-ops');

function rollback(journal, createdDirs, batchId, { verifyContent }) {
  const restored = [];
  const failures = [];
  for (const j of journal.slice().reverse()) {
    const w = j.w;
    try {
      const newer = lastBatchByPath.get(w.abs);
      if (newer !== undefined && newer > batchId) {
        failures.push({ path: w.rel, code: 'NEWER_BATCH', message: `${w.rel}: sudah ditulis batch yang lebih baru (#${newer}); tidak dikembalikan` });
        continue;
      }
      const cur = readCurrent(w.abs);
      if (j.kind === 'put') {
        if (verifyContent && (!cur.exists || cur.weird || sha256(cur.buf) !== w.after.hash)) {
          failures.push({ path: w.rel, code: 'CHANGED_SINCE_WRITE', message: `${w.rel}: isinya berubah setelah ditulis; tidak dikembalikan` });
          continue;
        }
        if (cur.weird) {
          failures.push({ path: w.rel, code: 'CHANGED_SINCE_WRITE', message: `${w.rel}: bukan file biasa lagi; tidak dikembalikan` });
          continue;
        }
        if (w.before.exists) restoreFile(w);
        else if (cur.exists) state.fs.unlinkSync(w.abs);
      } else {
        if (cur.exists) {
          failures.push({ path: w.rel, code: 'CHANGED_SINCE_WRITE', message: `${w.rel}: muncul lagi setelah dihapus; tidak dikembalikan` });
          continue;
        }
        restoreFile(w);
      }
      lastBatchByPath.delete(w.abs);
      restored.push(w.rel);
    } catch (err) {
      failures.push({ path: w.rel, code: 'ROLLBACK_ERROR', message: `${w.rel}: ${err.message}` });
    }
  }
  for (const d of createdDirs.slice().reverse()) {
    try { state.fs.rmdirSync(d); } catch {}
  }
  return { attempted: true, ok: failures.length === 0, restored, failures };
}

module.exports = { rollback };
