'use strict';

const path = require('path');
const workspace = require('../workspace/workspace');
const { warningsFor } = require('./syntax-check');
const { LIMITS, DEPENDENCY_FILES } = require('./plan/limits');
const { countLines, eolOf, fitEol } = require('./plan/text');
const { sha256, pathKey, canonical } = require('./plan/identity');
const { parseOperations } = require('./plan/parse');
const { doEdit, doCreate, doDelete, doRename } = require('./plan/operations');

function planPatch(input) {
  if (!workspace.hasRoot()) return { ok: false, error: workspace.NO_ROOT };
  const parsed = parseOperations(input);
  if (parsed.error) return { ok: false, error: parsed.error };

  const st = { entries: new Map(), norm: [], reasons: [], linesAdded: 0, linesRemoved: 0 };
  const handlers = { edit: doEdit, create: doCreate, delete: doDelete, rename: doRename };

  for (let i = 0; i < parsed.ops.length; i++) {
    const o = parsed.ops[i];
    const err = handlers[o.op](st, o);
    if (err) return { ok: false, error: `Operasi #${i + 1} (${o.op}): ${err}` };
    if (st.linesAdded + st.linesRemoved > LIMITS.MAX_LINES) {
      return {
        ok: false,
        error: `Patch melewati batas ${LIMITS.MAX_LINES} baris (tambah+hapus, satu baris diganti dihitung 2). ` +
          'Pecah menjadi beberapa patch yang lebih kecil.',
      };
    }
  }
  const normOps = st.norm;
  const reasons = st.reasons;
  const writes = [];
  let totalBytes = 0;
  for (const e of st.entries.values()) {
    const changed = e.exists !== e.existedBefore || (e.exists && !e.buf.equals(e.before));
    if (!changed) continue;
    if (e.exists) totalBytes += e.buf.length;
    writes.push({
      rel: e.rel,
      abs: e.abs,
      action: !e.exists ? 'delete' : e.existedBefore ? 'modify' : 'create',
      mode: e.mode,
      before: { exists: e.existedBefore, hash: e.beforeHash, buf: e.before },
      after: { exists: e.exists, hash: e.exists ? sha256(e.buf) : null, buf: e.buf },
    });
  }
  if (!writes.length) return { ok: false, error: 'Patch tidak mengubah apa pun' };
  if (totalBytes > LIMITS.MAX_TOTAL_BYTES) {
    return { ok: false, error: `Total isi file hasil patch terlalu besar (maks ${LIMITS.MAX_TOTAL_BYTES / 1024} KB)` };
  }
  writes.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  for (const e of st.entries.values()) {
    const base = path.posix.basename(e.rel).toLowerCase();
    if (DEPENDENCY_FILES.has(base)) reasons.push(`menyentuh ${e.rel}`);
  }
  const kind = reasons.length ? 'destructive' : 'additive';
  const touched = [];
  for (const o of normOps) {
    if (o.op === 'rename') {
      touched.push({ path: o.from, op: 'rename-from' }, { path: o.to, op: 'rename-to' });
    } else {
      touched.push({ path: o.path, op: o.op });
    }
  }
  const prereq = [...st.entries.values()]
    .map((e) => ({ path: e.rel, hash: e.beforeHash }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  const digest = sha256(Buffer.from(canonical({ v: 1, ops: normOps, prereq }), 'utf8'));
  const stats = {
    operations: normOps.length,
    files: st.entries.size,
    linesAdded: st.linesAdded,
    linesRemoved: st.linesRemoved,
    lines: st.linesAdded + st.linesRemoved,
    bytes: totalBytes,
  };
  return {
    ok: true,
    plan: {
      root: workspace.getRoot(),
      digest,
      kind,
      reasons,
      stats,
      touched,
      ops: normOps,
      writes,
      warnings: warningsFor(writes),
    },
  };
}

function describePlan(plan) {
  const s = plan.stats;
  const c = { create: 0, modify: 0, delete: 0 };
  for (const w of plan.writes) c[w.action] += 1;
  const parts = [];
  if (c.modify) parts.push(`${c.modify} diubah`);
  if (c.create) parts.push(`${c.create} baru`);
  if (c.delete) parts.push(`${c.delete} dihapus`);
  const jenis = plan.kind === 'destructive' ? 'bersifat merusak (hapus/ganti nama/berkas dependensi)' : 'hanya menambah/mengubah';
  return `${plan.writes.length} file (${parts.join(', ')}), ${s.linesAdded} baris ditambah dan ${s.linesRemoved} dihapus, ${jenis}`;
}

module.exports = {
  planPatch, parseOperations, describePlan, countLines, sha256, canonical, pathKey, LIMITS, DEPENDENCY_FILES,
  __test: { eolOf, fitEol, pathKey },
};
