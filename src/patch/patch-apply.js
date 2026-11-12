'use strict';

const fs = require('fs');
const path = require('path');
const workspace = require('../workspace/workspace');
const { planPatch } = require('./patch-plan');
const { sha256 } = require('./plan/identity');
const { state, lastBatchByPath } = require('./apply/state');
const { readCurrent, mkdirTracked, writeTemp, unlinkQuiet } = require('./apply/fs-ops');
const { rollback } = require('./apply/rollback');
const { failure, withRollback } = require('./apply/results');

function applyOperations(operations, { approvedDigest } = {}) {
  const planned = planPatch(operations);
  if (!planned.ok) return failure(planned.error, 'INVALID');
  const plan = planned.plan;
  if (!approvedDigest) return failure('Persetujuan tidak terikat digest; patch tidak diterapkan', 'NO_DIGEST');
  if (plan.digest !== approvedDigest) {
    return failure('Isi file atau operasi berubah sejak disetujui (digest tidak cocok); patch tidak diterapkan', 'DIGEST_MISMATCH');
  }
  if (plan.root !== workspace.getRoot()) return failure('Folder proyek berganti; patch tidak diterapkan', 'ROOT_CHANGED');
  for (const w of plan.writes) {
    let cur;
    try { cur = readCurrent(w.abs); } catch (err) { return failure(`${w.rel}: ${err.message}`, 'STALE'); }
    const nowHash = cur.exists && !cur.weird ? sha256(cur.buf) : null;
    if (cur.weird || cur.exists !== w.before.exists || nowHash !== w.before.hash) {
      return failure(`${w.rel}: berubah sejak direncanakan; patch tidak diterapkan`, 'STALE');
    }
  }
  let backups = 0;
  try {
    for (const w of plan.writes) {
      if (w.before.exists && workspace.backupBeforeWrite(w.abs, w.rel)) backups += 1;
    }
  } catch (err) {
    return failure(`Gagal membuat cadangan: ${err.message}; patch tidak diterapkan`, 'BACKUP_FAILED');
  }

  const batchId = ++state.batchSeq;
  const createdDirs = [];
  const staged = [];       
  const journal = [];      
  const cleanupTemps = () => { for (const s of staged) unlinkQuiet(s.tmp); };

  try {
    for (const w of plan.writes) {
      if (!w.after.exists) continue;
      mkdirTracked(path.dirname(w.abs), createdDirs);
      staged.push({ w, tmp: writeTemp(w.abs, w.after.buf, w.mode) });
    }
  } catch (err) {
    cleanupTemps();
    for (const d of createdDirs.slice().reverse()) { try { state.fs.rmdirSync(d); } catch {} }
    return failure(`Gagal menyiapkan file sementara: ${err.message}. Tidak ada file proyek yang berubah`, 'STAGE_FAILED');
  }

  let step = '';
  try {
    for (const s of staged) {
      step = s.w.rel;
      state.fs.renameSync(s.tmp, s.w.abs);
      s.done = true;
      journal.push({ w: s.w, kind: 'put' });
      lastBatchByPath.set(s.w.abs, batchId);
    }
    for (const w of plan.writes) {
      if (w.after.exists) continue;
      step = w.rel;
      state.fs.unlinkSync(w.abs);
      journal.push({ w, kind: 'del' });
      lastBatchByPath.set(w.abs, batchId);
    }
  } catch (err) {
    for (const s of staged) if (!s.done) unlinkQuiet(s.tmp);
    const rb = rollback(journal, createdDirs, batchId, { verifyContent: true });
    return withRollback(failure(`Gagal menulis ${step}: ${err.message}`, 'COMMIT_FAILED'), rb);
  }
  try {
    for (const w of plan.writes) {
      const cur = readCurrent(w.abs);
      if (w.after.exists) {
        if (!cur.exists || cur.weird || sha256(cur.buf) !== w.after.hash) throw new Error(`${w.rel}: isi hasil tulis tidak cocok`);
      } else if (cur.exists) {
        throw new Error(`${w.rel}: masih ada setelah dihapus`);
      }
    }
  } catch (err) {
    const rb = rollback(journal, createdDirs, batchId, { verifyContent: false });
    return withRollback(failure(`Verifikasi gagal: ${err.message}`, 'VERIFY_FAILED'), rb);
  }
  console.log(`[patch] batch #${batchId} diterapkan: ${plan.writes.map((w) => `${w.action}:${w.rel}`).join(', ')}`);
  return {
    success: true,
    batchId,
    digest: plan.digest,
    kind: plan.kind,
    files: plan.writes.map((w) => ({ path: w.rel, action: w.action })),
    stats: plan.stats,
    backupsSaved: backups,
    message: `Patch diterapkan: ${plan.writes.length} file, ${plan.stats.linesAdded} baris ditambah, ${plan.stats.linesRemoved} dihapus`,
    ...(plan.warnings && plan.warnings.length
      ? {
          warnings: plan.warnings,
          warningNote: 'Pemeriksaan sintaks otomatis menemukan kemungkinan masalah (bisa positif palsu untuk JSX/TypeScript/ESM). ' +
            'Baca ulang bagian itu dan perbaiki dengan patch kecil bila memang salah.',
        }
      : {}),
  };
}

module.exports = {
  applyOperations,
  __test: {
    setFs(overrides) { state.fs = Object.assign(Object.create(fs), overrides); },
    reset() { state.fs = fs; state.batchSeq = 0; lastBatchByPath.clear(); },
    markBatch(abs, id) { lastBatchByPath.set(abs, id); },
    currentBatch() { return state.batchSeq; },
  },
};
