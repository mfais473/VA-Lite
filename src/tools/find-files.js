const path = require('path');
const os = require('os');
const fg = require('fast-glob');
const { isInsideAllowed, allowedRoots, resolveUserPath } = require('./path-guard');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function fmtDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function fmtKB(bytes) {
  return Math.max(1, Math.round(bytes / 1024));
}

const findFiles = {
  name: 'find_files',
  description:
    'Mencari file di komputer berdasarkan pola nama atau ekstensi, sampai ke dalam subfolder, tanpa ' +
    'membedakan huruf besar-kecil. Hasil diurutkan dari yang TERBARU diubah. Contoh: ' +
    'cari semua file PDF, cari file bernama "laporan", cari file .docx di Documents. ' +
    'Hanya mencari di dalam folder yang diizinkan (default: folder home pengguna).',
  params: {
    pattern: { type: 'string', required: true, description: 'Pola pencarian, contoh: *.pdf, laporan*.docx' },
    folder:  { type: 'string', required: false, description: 'Folder awal: nama relatif terhadap home (mis. Downloads, Documents/Kuliah) atau ~/Downloads. Jangan pakai variabel seperti %USERNAME%; kosongkan bila tidak yakin' },
    limit:   { type: 'string', required: false, description: `Maksimal hasil (default ${DEFAULT_LIMIT}, maks ${MAX_LIMIT})` },
  },
  permission: 'auto',
  untrusted: true,
  describe: ({ pattern }) => `Boleh aku mencari file dengan pola ${pattern || 'tertentu'} di komputer kamu?`,
  historyNote: (args, result) => {
    if (!result || !result.success || !Array.isArray(result.files) || !result.files.length) return '';
    const top = result.files.slice(0, 5).map((f, i) => `${i + 1}. ${f.path}`).join('\n');
    return `ditemukan ${result.total} file untuk pola ${result.pattern}; teratas (terbaru dulu):\n${top}`;
  },
  execute: async ({ pattern, folder, limit }) => {
    if (!pattern) return { success: false, error: 'Pattern kosong' };
    if (pattern.includes('..') || path.isAbsolute(pattern)) {
      return { success: false, error: 'Pola tidak boleh berisi ".." atau path absolut' };
    }
    const home = os.homedir();
    const cwds = folder
      ? [resolveUserPath(folder)]
      : (isInsideAllowed(home) ? [home] : allowedRoots());
    for (const cwd of cwds) {
      if (!isInsideAllowed(cwd)) {
        return {
          success: false,
          error: `Folder di luar area yang diizinkan (${cwd}). Folder yang diizinkan: ${allowedRoots().join(' ; ')}`,
        };
      }
    }
    const max = Math.min(parseInt(limit, 10) || DEFAULT_LIMIT, MAX_LIMIT);
    try {
      const byPath = new Map();
      for (const cwd of cwds) {
        const entries = await fg(pattern, {
          cwd,
          absolute: true,
          onlyFiles: true,
          deep: 6,
          followSymbolicLinks: false,
          ignore: ['**/node_modules/**', '**/AppData/**', '**/.git/**'],
          suppressErrors: true,
          baseNameMatch: true,
          caseSensitiveMatch: false,
          stats: true,
        });
        for (const e of entries) {
          if (!byPath.has(e.path)) byPath.set(e.path, e);
        }
      }
      const safe = Array.from(byPath.values())
        .filter((e) => isInsideAllowed(e.path))
        .sort((a, b) => ((b.stats && b.stats.mtimeMs) || 0) - ((a.stats && a.stats.mtimeMs) || 0));
      const results = safe.slice(0, max).map((e) => ({
        path: e.path,
        ...(e.stats ? { sizeKB: fmtKB(e.stats.size), modified: fmtDate(e.stats.mtimeMs) } : {}),
      }));
      return {
        success: true,
        folder: cwds.join(' ; '),
        pattern,
        total: safe.length,
        returned: results.length,
        sortedBy: 'terbaru diubah',
        files: results,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
};

module.exports = findFiles;
