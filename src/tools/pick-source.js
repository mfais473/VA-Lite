const path = require('path');
const workspace = require('../workspace/workspace');
const picked = require('./picked-access');
const { scanFolder, isKind, KINDS } = require('./folder-scan');
const { readExcelFile } = require('./excel/read-core');
const { readWordFile } = require('./word/read-core');
const { loadImageFile } = require('./image-core');
const pdfCore = require('./pdf-core');

const KIND_LIST = ['project', 'excel', 'word', 'pdf', 'image'];
const MAX_LISTED = 100;

function fmtKB(bytes) {
  return Math.max(1, Math.round(bytes / 1024));
}

function dialogs() {
  const { dialog, BrowserWindow } = require('electron');
  return { dialog, win: BrowserWindow.getFocusedWindow() };
}

async function askMode(kind) {
  const { dialog, win } = dialogs();
  const options = {
    type: 'question',
    title: 'Pilih sumber',
    message: `Mau pilih satu file atau satu folder ${KINDS[kind].label}?`,
    detail: 'Kalau memilih folder, Via bisa membaca semua file yang cocok di dalamnya.',
    buttons: ['Pilih file', 'Pilih folder', 'Batal'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  };
  const r = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
  if (r.response === 0) return 'file';
  if (r.response === 1) return 'folder';
  return null;
}

async function openDialog(options) {
  const { dialog, win } = dialogs();
  return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options);
}

async function pickProject() {
  const result = await openDialog({ title: 'Pilih folder proyek', properties: ['openDirectory'] });
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, error: 'Pengguna membatalkan pemilihan folder' };
  }
  const set = workspace.setRoot(result.filePaths[0]);
  if (set.error) return { success: false, error: set.error };
  return {
    success: true,
    kind: 'project',
    folder: set.name,
    message: `Folder proyek "${set.name}" dipilih. Mulai sekarang kamu hanya bisa membaca/mengubah isi folder ini.`,
  };
}

async function pickFile(kind) {
  const exts = KINDS[kind].exts.map((e) => e.slice(1));
  const result = await openDialog({
    title: `Pilih file ${KINDS[kind].label}`,
    filters: [{ name: KINDS[kind].label, extensions: exts }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, error: 'Pengguna membatalkan pemilihan file' };
  }
  const filePath = result.filePaths[0];
  picked.grantFile(filePath);
  try {
    let out;
    if (kind === 'excel') out = await readExcelFile(filePath);
    else if (kind === 'word') out = await readWordFile(filePath);
    else if (kind === 'pdf') out = await pdfCore.readPdfFile(filePath);
    else out = await loadImageFile(filePath);
    return out && out.success ? { ...out, kind, selection: 'file' } : out;
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function pickFolder(kind) {
  const result = await openDialog({
    title: `Pilih folder berisi file ${KINDS[kind].label}`,
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, error: 'Pengguna membatalkan pemilihan folder' };
  }
  const scan = scanFolder(result.filePaths[0], kind);
  if (scan.error) return { success: false, error: scan.error };
  picked.grantFolder(scan.root);
  const shown = scan.files.slice(0, MAX_LISTED);
  const lines = shown.map((f, i) => `${i + 1}. ${f.rel} (${fmtKB(f.size)} KB)`);
  if (scan.files.length > shown.length) lines.push(`... dan ${scan.files.length - shown.length} file lain`);
  return {
    success: true,
    kind,
    selection: 'folder',
    folder: scan.root,
    path: scan.root,
    total: scan.files.length,
    ...(scan.capped ? { capped: true } : {}),
    note: scan.files.length
      ? `Folder dipilih. Untuk membaca isinya pakai read_folder (kind ${kind}); belum ada isi file yang terbaca.` +
        (scan.capped ? ' Pemindaian dibatasi, mungkin ada file lain yang tidak terdaftar.' : '')
      : `Tidak ada file ${KINDS[kind].label} di folder ini (subfolder sampai kedalaman 4 sudah dicek).`,
    text: lines.join('\n') || '(kosong)',
  };
}

const pickSource = {
  name: 'pick_source',
  description:
    'Membuka dialog agar PENGGUNA memilih sumber data di komputernya: satu file ATAU satu folder. Satu tool untuk semua jenis: ' +
    'kind "project" = folder proyek untuk mode coding (hanya folder); kind "excel", "word", "pdf", atau "image" = file atau folder berisi ' +
    'jenis berkas itu. Pakai saat pengguna ingin kamu membaca file miliknya tetapi tidak menyebut path lengkap. ' +
    'Kalau mode tidak diisi, pengguna ditanya apakah memilih file atau folder. Memilih satu file langsung membaca isinya; ' +
    'memilih folder menghasilkan daftar file, lalu baca semuanya dengan read_folder. ' +
    'Untuk screenshot jangan pakai tool ini (pakai screenshot lalu view_screenshot).',
  params: {
    kind: { type: 'string', required: true, description: 'project | excel | word | pdf | image' },
    mode: { type: 'string', required: false, description: 'file | folder. Isi HANYA bila pengguna jelas menyebut "file" atau "folder"; kosongkan agar pengguna memilih sendiri. Diabaikan untuk kind project.' },
  },
  permission: 'auto',
  untrusted: true,
  describe: ({ kind }) => {
    if (kind === 'project') return 'Boleh aku membuka jendela pemilih folder proyek?';
    const label = isKind(kind) ? KINDS[kind].label : 'berkas';
    return `Boleh aku membuka jendela pemilih file atau folder ${label}?`;
  },
  validate: ({ kind }) => (KIND_LIST.includes(kind) ? null : `kind harus salah satu dari: ${KIND_LIST.join(', ')}`),
  codingFor: ({ kind }) => kind === 'project',
  taintFreeFor: ({ kind }) => kind === 'project',
  historyNote: (args, result) => {
    if (!result || !result.success) return '';
    if (result.selection === 'folder') return `folder dipilih: ${result.total} file ${result.kind}`;
    if (result.kind === 'pdf') return pdfCore.historyNote(args, result);
    return '';
  },
  toArtifact: (args, result) => {
    if (result.selection !== 'file') return null;
    if (result.kind === 'excel') {
      return { type: 'excel', path: result.path, sheet: result.sheet, rows: result.totalRows, cols: result.totalCols, columns: result.columns };
    }
    if (result.kind === 'word') {
      return { type: 'word', path: result.path, blocks: result.totalBlocks, headings: (result.outline || []).map((h) => h.text) };
    }
    if (result.kind === 'pdf') return { type: 'pdf', path: result.path, pages: result.pages };
    if (result.kind === 'image') return { type: 'image', path: result.path };
    return null;
  },
  execute: async ({ kind, mode }) => {
    if (!KIND_LIST.includes(kind)) return { success: false, error: `kind harus salah satu dari: ${KIND_LIST.join(', ')}` };
    try {
      if (kind === 'project') return await pickProject();
      let chosen = String(mode || '').trim().toLowerCase();
      if (chosen !== 'file' && chosen !== 'folder') chosen = await askMode(kind);
      if (!chosen) return { success: false, error: 'Pengguna membatalkan pemilihan' };
      return chosen === 'folder' ? await pickFolder(kind) : await pickFile(kind);
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
};

module.exports = pickSource;
