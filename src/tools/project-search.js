const fs = require('fs/promises');
const path = require('path');
const workspace = require('../workspace/workspace');

const { SKIP_DIRS } = require('../shared/skip-dirs');
const DEFAULT_MAX = 30;
const HARD_MAX = 100;
const PER_FILE_MAX = 8;
const MAX_FILES_SCANNED = 3000;
const TIME_BUDGET_MS = 4000;
const MAX_LINE_CHARS = 200;
const MAX_SCAN_LINE_CHARS = 2000;
const MAX_TERMS = 5;
const MAX_TERM_LEN = 120;

const clean = (s) => String(s).replace(/[\u0000-\u001f\u007f]/g, ' ');

function parseTerms(query) {
  return String(query || '').split('|').map((t) => t.trim()).filter(Boolean);
}

function parseInclude(include) {
  if (!include) return null;
  const exts = String(include).split(',')
    .map((t) => t.trim().toLowerCase().replace(/^\*?\./, ''))
    .filter((t) => t && !t.includes('/') && !t.includes('*'));
  return exts.length ? new Set(exts) : null;
}

async function* walkFiles(startAbs, startRel) {
  const queue = [{ abs: startAbs, rel: startRel }];
  while (queue.length) {
    const dir = queue.shift();
    let entries;
    try { entries = await fs.readdir(dir.abs, { withFileTypes: true }); } catch { continue; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const rel = dir.rel === '.' ? e.name : `${dir.rel}/${e.name}`;
      if (workspace.policyError(rel.split('/'), 'read')) continue;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name.toLowerCase())) queue.push({ abs: path.join(dir.abs, e.name), rel });
      } else if (e.isFile()) {
        yield { abs: path.join(dir.abs, e.name), rel };
      }
    }
  }
}

function buildRanges(hits, context, total) {
  const ranges = [];
  for (const i of hits) {
    const from = Math.max(0, i - context);
    const to = Math.min(total - 1, i + context);
    const last = ranges[ranges.length - 1];
    if (last && from <= last.to + 1) last.to = Math.max(last.to, to);
    else ranges.push({ from, to });
  }
  return ranges;
}

const projectSearch = {
  name: 'project_search',
  description:
    'Mencari teks (literal, bukan regex) di semua file teks dalam folder proyek aktif dan mengembalikan ' +
    'path:nomor-baris beserta barisnya. Pakai untuk menemukan di mana fungsi, variabel, atau pesan error dipakai, ' +
    'lalu baca rentang barisnya dengan project_read_file. Beberapa kata dipisah dengan | (cocok salah satu).',
  params: {
    query: { type: 'string', required: true, description: `Teks yang dicari; pisahkan dengan | untuk beberapa kata (maks ${MAX_TERMS})` },
    path: { type: 'string', required: false, description: 'Sub-folder untuk dibatasi, mis. src. Kosong = seluruh proyek' },
    include: { type: 'string', required: false, description: 'Batasi ekstensi file, mis. js,json' },
    caseSensitive: { type: 'string', required: false, description: 'Isi "true" untuk membedakan huruf besar-kecil (default tidak)' },
    context: { type: 'string', required: false, description: 'Jumlah baris konteks di sekitar hasil, 0-2 (default 0)' },
    maxResults: { type: 'string', required: false, description: `Maksimal hasil (default ${DEFAULT_MAX}, maks ${HARD_MAX})` },
  },
  permission: 'auto',
  untrusted: true,
  taintExempt: true,
  coding: true,
  describe: ({ query }) => `Boleh aku mencari "${clean(query || '').slice(0, 60)}" di proyek?`,
  validate: ({ query, path: p }) => {
    if (!workspace.hasRoot()) return workspace.NO_ROOT || 'Belum ada folder proyek aktif';
    const terms = parseTerms(query);
    if (!terms.length) return 'Kata yang dicari kosong';
    if (terms.length > MAX_TERMS) return `Terlalu banyak kata (maks ${MAX_TERMS})`;
    if (terms.some((t) => t.length > MAX_TERM_LEN)) return `Satu kata maksimal ${MAX_TERM_LEN} karakter`;
    const r = workspace.resolveInRoot(p || '.', 'read', { allowRoot: true });
    return r.error || null;
  },
  historyNote: (args, result) => (result && result.success
    ? `cari "${clean(result.query).slice(0, 80)}": ${result.matches} hasil di ${result.filesWithMatches} file` +
      (result.truncated ? ' (dibatasi)' : '')
    : ''),
  execute: async ({ query, path: p, include, caseSensitive, context, maxResults }) => {
    const bad = projectSearch.validate({ query, path: p });
    if (bad) return { success: false, error: bad };
    const r = workspace.resolveInRoot(p || '.', 'read', { allowRoot: true });
    let st;
    try { st = await fs.stat(r.abs); } catch { return { success: false, error: 'Folder tidak ditemukan' }; }
    if (!st.isDirectory()) return { success: false, error: 'Path itu bukan folder' };

    const terms = parseTerms(query);
    const cs = String(caseSensitive || '').toLowerCase() === 'true';
    const needles = cs ? terms : terms.map((t) => t.toLowerCase());
    const exts = parseInclude(include);
    const ctxLines = Math.min(Math.max(parseInt(context, 10) || 0, 0), 2);
    const max = Math.min(Math.max(parseInt(maxResults, 10) || DEFAULT_MAX, 1), HARD_MAX);

    const deadline = Date.now() + TIME_BUDGET_MS;
    const out = [];
    let matches = 0;
    let filesWithMatches = 0;
    let scanned = 0;
    let stoppedBy = null;

    for await (const f of walkFiles(r.abs, r.rel)) {
      if (scanned >= MAX_FILES_SCANNED) { stoppedBy = 'jumlah_file'; break; }
      if (Date.now() > deadline) { stoppedBy = 'waktu'; break; }
      if (exts && !exts.has(path.extname(f.rel).slice(1).toLowerCase())) continue;
      scanned += 1;
      if (scanned % 50 === 0) await new Promise((resolve) => setImmediate(resolve));

      let buf;
      try {
        const s = await fs.stat(f.abs);
        if (s.size > workspace.MAX_READ_BYTES) continue;
        buf = await fs.readFile(f.abs);
      } catch { continue; }
      if (workspace.looksBinary(buf)) continue;

      const lines = buf.toString('utf8').split(/\r?\n/);
      const hits = [];
      for (let i = 0; i < lines.length && hits.length < PER_FILE_MAX; i++) {
        const raw = lines[i].length > MAX_SCAN_LINE_CHARS ? lines[i].slice(0, MAX_SCAN_LINE_CHARS) : lines[i];
        const hay = cs ? raw : raw.toLowerCase();
        if (needles.some((n) => hay.includes(n))) hits.push(i);
      }
      if (!hits.length) continue;

      const room = max - matches;
      const used = hits.slice(0, room);
      filesWithMatches += 1;
      matches += used.length;
      const hitSet = new Set(used);
      for (const range of buildRanges(used, ctxLines, lines.length)) {
        if (out.length) out.push('--');
        for (let i = range.from; i <= range.to; i++) {
          const mark = hitSet.has(i) ? ':' : '-';
          out.push(`${clean(f.rel)}${mark}${i + 1}${mark} ${clean(lines[i]).slice(0, MAX_LINE_CHARS)}`);
        }
      }
      if (matches >= max) { stoppedBy = 'maks_hasil'; break; }
    }

    const truncated = stoppedBy !== null;
    return {
      success: true,
      query: terms.join(' | '),
      folder: r.rel,
      matches,
      filesWithMatches,
      filesScanned: scanned,
      truncated,
      ...(stoppedBy ? { stoppedBy } : {}),
      ...(truncated ? { note: 'Hasil dibatasi. Persempit dengan path atau include, atau pakai kata yang lebih spesifik.' } : {}),
      text: out.join('\n') || '(tidak ada yang cocok)',
    };
  },
};

module.exports = projectSearch;
module.exports.__test = { parseTerms, parseInclude, buildRanges };
