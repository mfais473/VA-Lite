const fs = require('fs');
const workspace = require('../../workspace/workspace');
const { LIMITS } = require('./limits');
const { sha256, pathKey } = require('./identity');

function touch(st, relInput) {
  const r = workspace.resolveInRoot(relInput, 'write');
  if (r.error) return { error: `${relInput}: ${r.error}` };
  const key = pathKey(r.rel);
  const have = st.entries.get(key);
  if (have) return { e: have };
  if (st.entries.size >= LIMITS.MAX_FILES) {
    return { error: `Patch menyentuh lebih dari ${LIMITS.MAX_FILES} file (rename menghitung dua path)` };
  }
  let lst = null;
  try {
    lst = fs.lstatSync(r.abs);
  } catch (err) {
    if (err.code !== 'ENOENT') return { error: `${r.rel}: tidak bisa diperiksa (${err.code || err.message})` };
  }
  let before = null;
  if (lst) {
    if (lst.isSymbolicLink()) return { error: `${r.rel}: symlink tidak boleh diubah lewat patch` };
    if (!lst.isFile()) return { error: `${r.rel}: bukan file biasa` };
    if (lst.size > workspace.MAX_WRITE_BYTES) return { error: `${r.rel}: file terlalu besar untuk patch` };
    try { before = fs.readFileSync(r.abs); } catch (err) { return { error: `${r.rel}: gagal dibaca (${err.message})` }; }
  }
  const e = {
    rel: r.rel,
    abs: r.abs,
    key,
    existedBefore: before !== null,
    before,
    beforeHash: before ? sha256(before) : null,
    mode: lst ? lst.mode & 0o777 : 0o644,
    exists: before !== null,
    buf: before,
  };
  st.entries.set(key, e);
  return { e };
}

function textOf(e) {
  if (workspace.looksBinary(e.buf)) return { error: `${e.rel}: file biner, bukan teks` };
  const s = e.buf.toString('utf8');
  if (!Buffer.from(s, 'utf8').equals(e.buf)) {
    return { error: `${e.rel}: bukan UTF-8 murni (mungkin Latin-1/ANSI), tidak aman diubah` };
  }
  return { text: s };
}

function validNewText(rel, s) {
  if (s.includes('\0')) return `${rel}: isi mengandung karakter NUL (biner)`;
  if (typeof s.isWellFormed === 'function' && !s.isWellFormed()) return `${rel}: isi bukan UTF-8 yang valid (surrogate yatim)`;
  if (s.includes('\uFFFD')) return `${rel}: isi mengandung karakter pengganti U+FFFD (teks rusak)`;
  return null;
}

module.exports = { touch, textOf, validNewText };
