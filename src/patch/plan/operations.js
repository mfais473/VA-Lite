const workspace = require('../../workspace/workspace');
const { LIMITS } = require('./limits');
const { countLines, countOccurrences, eolOf, fitEol } = require('./text');
const { touch, textOf, validNewText } = require('./entries');

function doEdit(st, o) {
  const t = touch(st, o.path);
  if (t.error) return t.error;
  const e = t.e;
  if (!e.exists) return `${e.rel}: file belum ada (pakai op "create" untuk file baru)`;
  if (o.oldText.length > LIMITS.MAX_OLD_CHARS || o.newText.length > LIMITS.MAX_NEW_CHARS) {
    return `${e.rel}: teks terlalu panjang, pecah menjadi beberapa edit kecil`;
  }
  const cur = textOf(e);
  if (cur.error) return cur.error;
  const content = cur.text;
  const bad = validNewText(e.rel, o.newText);
  if (bad) return bad;

  const eol = eolOf(content);
  const oldFit = fitEol(o.oldText, eol);
  let oldUse = oldFit;
  let newUse = fitEol(o.newText, eol);
  let count = countOccurrences(content, oldUse);
  if (count === 0 && o.oldText !== oldFit) {
    count = countOccurrences(content, o.oldText);
    if (count > 0) { oldUse = o.oldText; newUse = o.newText; }
  }
  if (oldUse === newUse) return `${e.rel}: tidak ada perubahan (teks lama sama dengan teks baru)`;
  if (count === 0) {
    return `${e.rel}: oldText tidak ditemukan (spasi/indentasi harus persis). Baca ulang file lalu coba lagi`;
  }
  if (count > 1 && !o.replaceAll) {
    return `${e.rel}: oldText ditemukan ${count} kali. Tambahkan konteks agar unik, atau set replaceAll=true`;
  }
  const updated = o.replaceAll
    ? content.split(oldUse).join(newUse)
    : content.slice(0, content.indexOf(oldUse)) + newUse + content.slice(content.indexOf(oldUse) + oldUse.length);
  if (Buffer.byteLength(updated, 'utf8') > workspace.MAX_WRITE_BYTES) return `${e.rel}: hasil edit terlalu besar`;
  e.buf = Buffer.from(updated, 'utf8');
  st.norm.push({ op: 'edit', path: e.rel, oldText: o.oldText, newText: o.newText, replaceAll: o.replaceAll });
  const n = o.replaceAll ? count : 1;
  st.linesRemoved += countLines(o.oldText) * n;
  st.linesAdded += countLines(o.newText) * n;
  return null;
}

function doCreate(st, o) {
  const t = touch(st, o.path);
  if (t.error) return t.error;
  const e = t.e;
  if (e.exists) return `${e.rel}: file sudah ada (pakai op "edit" untuk mengubahnya)`;
  if (Buffer.byteLength(o.content, 'utf8') > workspace.MAX_WRITE_BYTES) {
    return `${e.rel}: isi terlalu besar (maks ${workspace.MAX_WRITE_BYTES / 1024} KB)`;
  }
  const bad = validNewText(e.rel, o.content);
  if (bad) return bad;
  e.exists = true;
  e.buf = Buffer.from(o.content, 'utf8');
  st.norm.push({ op: 'create', path: e.rel, content: o.content });
  st.linesAdded += countLines(o.content);
  return null;
}

function doDelete(st, o) {
  const t = touch(st, o.path);
  if (t.error) return t.error;
  const e = t.e;
  if (!e.exists) return `${e.rel}: file tidak ada, tidak bisa dihapus`;
  const cur = textOf(e);
  if (cur.error) return `${cur.error} (hapus file biner/non-UTF-8 secara manual)`;
  st.linesRemoved += countLines(cur.text);
  st.norm.push({ op: 'delete', path: e.rel });
  st.reasons.push(`hapus ${e.rel}`);
  e.exists = false;
  e.buf = null;
  return null;
}

function doRename(st, o) {
  const a = touch(st, o.from);
  if (a.error) return a.error;
  const b = touch(st, o.to);
  if (b.error) return b.error;
  if (a.e.key === b.e.key) return `${a.e.rel}: path asal dan tujuan sama`;
  if (!a.e.exists) return `${a.e.rel}: file asal tidak ada`;
  if (b.e.exists) return `${b.e.rel}: tujuan rename sudah ada`;
  st.norm.push({ op: 'rename', from: a.e.rel, to: b.e.rel });
  st.reasons.push(`rename ${a.e.rel} -> ${b.e.rel}`);
  b.e.exists = true;
  b.e.buf = a.e.buf;
  b.e.mode = a.e.mode;
  a.e.exists = false;
  a.e.buf = null;
  return null;
}

module.exports = { doEdit, doCreate, doDelete, doRename };
