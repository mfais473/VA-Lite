const fs = require('fs');
const path = require('path');
const { safeReal, isInside } = require('../workspace/paths');
const { SKIP_DIRS } = require('../shared/skip-dirs');

const KINDS = {
  excel: { exts: ['.xlsx'], label: 'Excel (.xlsx)' },
  word: { exts: ['.docx'], label: 'Word (.docx)' },
  pdf: { exts: ['.pdf'], label: 'PDF' },
  image: { exts: ['.png', '.jpg', '.jpeg', '.webp', '.gif'], label: 'gambar' },
};

const MAX_DEPTH = 4;
const MAX_VISITED = 20000;
const MAX_MATCHES = 500;
const SKIP_EXTRA = new Set(['.git', '.svn', '.hg', 'appdata', '$recycle.bin', 'system volume information']);

function isKind(kind) {
  return Object.prototype.hasOwnProperty.call(KINDS, kind);
}

function matches(kind, name) {
  if (name.startsWith('~$') || name.startsWith('.')) return false;
  return KINDS[kind].exts.includes(path.extname(name).toLowerCase());
}

function scanFolder(folder, kind) {
  if (!isKind(kind)) return { error: `Jenis berkas tidak dikenal: ${kind}` };
  let root;
  try {
    if (!fs.statSync(folder).isDirectory()) return { error: 'Yang dipilih bukan folder' };
    root = safeReal(folder);
  } catch (err) {
    return { error: `Folder tidak bisa dibuka: ${err.message}` };
  }
  if (path.parse(root).root === root) {
    return { error: 'Jangan memilih root drive. Pilih folder yang lebih spesifik.' };
  }

  const found = [];
  let visited = 0;
  let capped = false;
  let level = [root];
  for (let depth = 1; depth <= MAX_DEPTH + 1 && level.length && !capped; depth++) {
    const next = [];
    for (const dir of level) {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (++visited > MAX_VISITED || found.length >= MAX_MATCHES) { capped = true; break; }
        const abs = path.join(dir, e.name);
        if (e.isSymbolicLink()) continue;
        if (e.isDirectory()) {
          const lower = e.name.toLowerCase();
          if (SKIP_DIRS.has(lower) || SKIP_EXTRA.has(lower)) continue;
          if (depth <= MAX_DEPTH) next.push(abs);
        } else if (e.isFile() && matches(kind, e.name)) {
          if (!isInside(root, safeReal(abs))) continue;
          let size = 0;
          try { size = fs.statSync(abs).size; } catch {}
          found.push({ abs, rel: path.relative(root, abs).split(path.sep).join('/'), size });
        }
      }
      if (capped) break;
    }
    level = next;
  }
  found.sort((a, b) => a.rel.localeCompare(b.rel, undefined, { numeric: true, sensitivity: 'base' }));
  return { root, kind, files: found, capped };
}

module.exports = { scanFolder, isKind, matches, KINDS, MAX_DEPTH, MAX_MATCHES };
