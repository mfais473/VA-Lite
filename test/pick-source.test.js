require('./helpers/stub-modules');
const Module = require('module');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const fake = { responses: [], opened: [], messageBoxes: [], messageResponse: 1 };
const prevLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') {
    return {
      dialog: {
        showMessageBox: async (...a) => { fake.messageBoxes.push(a[a.length - 1]); return { response: fake.messageResponse }; },
        showOpenDialog: async (...a) => { fake.opened.push(a[a.length - 1]); return fake.responses.shift() || { canceled: true, filePaths: [] }; },
      },
      BrowserWindow: { getFocusedWindow: () => null },
    };
  }
  return prevLoad.call(this, request, ...rest);
};

const llm = require('../src/ai/llm-client');
const tools = require('../src/tools');
const picked = require('../src/tools/picked-access');
const ws = require('../src/workspace/workspace');
const agent = require('../src/agent/agent-loop');

const run = (name, args) => {
  const tool = tools.getTool(name);
  const norm = tools.normalizeArgs(tool, args);
  return tool.execute(norm.args);
};

function tmpTree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-pick-'));
  for (const f of files) {
    const p = path.join(dir, f);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'x');
  }
  return fs.realpathSync(dir);
}

test.beforeEach(() => {
  picked.reset();
  fake.responses = [];
  fake.opened = [];
  fake.messageBoxes = [];
  fake.messageResponse = 1;
  ws.clearRoot();
});

test('registry: tiga pemilih lama diganti pick_source + read_folder', () => {
  const names = tools.getToolSchemas().map((t) => t.name);
  for (const old of ['project_pick_folder', 'pdf_pick_and_read', 'image_pick_and_view']) assert.ok(!names.includes(old), old);
  assert.ok(names.includes('pick_source') && names.includes('read_folder'));
});

test('pick_source folder excel: pengguna ditanya file/folder, daftar hanya .xlsx, file sementara ~$ dilewati', async () => {
  const dir = tmpTree(['a.xlsx', 'sub/b.XLSX', '~$a.xlsx', 'c.pdf', 'e.docx', 'node_modules/z.xlsx', 'd.xls']);
  fake.responses = [{ canceled: false, filePaths: [dir] }];
  const r = await run('pick_source', { kind: 'excel' });
  assert.equal(fake.messageBoxes.length, 1);
  assert.equal(r.success, true);
  assert.equal(r.selection, 'folder');
  assert.equal(r.total, 2);
  assert.match(r.text, /a\.xlsx/);
  assert.match(r.text, /sub\/b\.XLSX/);
  assert.ok(!/~\$|c\.pdf|e\.docx|node_modules|d\.xls\b/.test(r.text));
  assert.equal(picked.isGranted(path.join(dir, 'sub', 'b.XLSX')), true);
  assert.equal(picked.latestFolder(), dir);
});

test('pick_source: mode folder dari model melewati pertanyaan; batal dikembalikan sebagai gagal', async () => {
  const r = await run('pick_source', { kind: 'pdf', mode: 'folder' });
  assert.equal(fake.messageBoxes.length, 0);
  assert.equal(r.success, false);
  fake.messageResponse = 2;
  const r2 = await run('pick_source', { kind: 'image' });
  assert.equal(r2.success, false);
  assert.equal(fake.opened.length, 1, 'tidak ada dialog buka setelah batal');
});

test('pick_source project: pasang folder proyek, tanpa pertanyaan, tidak mengotori (taint) dan mengaktifkan coding', async () => {
  const dir = tmpTree(['a.js']);
  const tool = tools.getTool('pick_source');
  assert.equal(tool.codingFor({ kind: 'project' }), true);
  assert.equal(tool.taintFreeFor({ kind: 'project' }), true);
  assert.equal(tool.taintFreeFor({ kind: 'excel' }), false);
  const home = os.homedir();
  const outside = dir.startsWith(home) ? null : dir;
  fake.responses = [{ canceled: false, filePaths: [dir] }];
  const r = await run('pick_source', { kind: 'project' });
  assert.equal(fake.messageBoxes.length, 0);
  if (outside) { assert.equal(r.success, true); assert.ok(ws.hasRoot()); }
});

test('pick_source: kind tidak dikenal ditolak; word dikenal', async () => {
  const tool = tools.getTool('pick_source');
  assert.match(await tools.validateCall(tool, { kind: 'pptx' }), /kind harus/);
  assert.equal(await tools.validateCall(tool, { kind: 'word' }), null);
});

test('pick_source folder word: hanya .docx (bukan .doc / ~$)', async () => {
  const dir = tmpTree(['a.docx', 'sub/b.DOCX', '~$a.docx', 'old.doc', 'x.xlsx']);
  fake.responses = [{ canceled: false, filePaths: [dir] }];
  const r = await run('pick_source', { kind: 'word', mode: 'folder' });
  assert.equal(r.total, 2);
  assert.ok(!/old\.doc\b|~\$|x\.xlsx/.test(r.text));
});

test('folder root drive dan folder kosong ditangani', async () => {
  const empty = tmpTree([]);
  fake.responses = [{ canceled: false, filePaths: [empty] }];
  const r = await run('pick_source', { kind: 'pdf', mode: 'folder' });
  assert.equal(r.success, true);
  assert.equal(r.total, 0);
  assert.match(r.note, /Tidak ada file/);
  const { scanFolder } = require('../src/tools/folder-scan');
  assert.match(scanFolder(path.parse(empty).root, 'pdf').error, /root drive/);
});

test('izin baca: read_excel/read_pdf menerima file di folder terpilih, menolak di luar', async () => {
  const dir = tmpTree([]);
  const other = tmpTree(['b.xlsx', 'b.pdf']);
  const prev = process.env.VIA_ALLOWED_DIRS;
  process.env.VIA_ALLOWED_DIRS = fs.mkdtempSync(path.join(os.tmpdir(), 'via-allowed-'));
  try {
    picked.grantFolder(dir);
    for (const name of ['read_excel', 'read_pdf', 'read_word']) {
      const ext = { read_excel: 'xlsx', read_pdf: 'pdf', read_word: 'docx' }[name];
      const outside = await run(name, { path: path.join(other, `b.${ext}`) });
      assert.match(outside.error, /di luar area/);
      const inside = await run(name, { path: path.join(dir, `tidak-ada.${ext}`) });
      assert.doesNotMatch(inside.error || '', /di luar area/, 'lolos penjaga izin, gagal di tahap baca file');
      assert.ok(inside.error);
    }
    assert.equal(picked.isGranted(path.join(dir, '..', path.basename(other), 'b.xlsx')), false);
  } finally {
    if (prev === undefined) delete process.env.VIA_ALLOWED_DIRS; else process.env.VIA_ALLOWED_DIRS = prev;
  }
});

test('izin baca: symlink dari folder terpilih ke luar tidak ikut', { skip: process.platform === 'win32' }, () => {
  const dir = tmpTree(['a.xlsx']);
  const other = tmpTree(['secret.xlsx']);
  fs.symlinkSync(path.join(other, 'secret.xlsx'), path.join(dir, 'link.xlsx'));
  picked.grantFolder(dir);
  assert.equal(picked.isGranted(path.join(dir, 'link.xlsx')), false);
  const { scanFolder } = require('../src/tools/folder-scan');
  assert.deepEqual(scanFolder(dir, 'excel').files.map((f) => f.rel), ['a.xlsx']);
});

test('read_folder: tanpa folder terpilih, folder di luar izin, dan startIndex berlebih gagal dengan jelas', async () => {
  assert.match((await run('read_folder', { kind: 'excel' })).error, /pick_source/);
  const stray = tmpTree(['a.xlsx']);
  const prev = process.env.VIA_ALLOWED_DIRS;
  process.env.VIA_ALLOWED_DIRS = fs.mkdtempSync(path.join(os.tmpdir(), 'via-allowed-'));
  try {
    assert.match((await run('read_folder', { kind: 'excel', folder: stray })).error, /di luar area/);
    picked.grantFolder(stray);
    assert.match((await run('read_folder', { kind: 'excel', startIndex: '5' })).error, /melebihi/);
  } finally {
    if (prev === undefined) delete process.env.VIA_ALLOWED_DIRS; else process.env.VIA_ALLOWED_DIRS = prev;
  }
  const tool = tools.getTool('read_folder');
  assert.equal(tool.permission, 'confirm');
  assert.match(await tools.validateCall(tool, { kind: 'project' }), /kind harus/);
  assert.equal(await tools.validateCall(tool, { kind: 'word' }), null);
});

test('konteks sesi memuat folder pilihan pengguna sebagai data', () => {
  const dir = tmpTree([]);
  picked.grantFolder(dir);
  assert.match(picked.renderBlock(), /picked_folders trust="data"/);
});

function script(items) {
  const seen = [];
  let i = 0;
  llm.callLLM = async (opts) => {
    seen.push({ tools: opts.tools, stable: opts.stableTools });
    return { text: '', toolCalls: [], ...items[Math.min(i++, items.length - 1)] };
  };
  return seen;
}
const call = (name, args, id = name) => ({ toolCalls: [{ id, name, args: { alasan: 'tes', ...args } }] });

test('semua tool dikirim di setiap langkah, sebelum dan sesudah mode coding aktif', async () => {
  const dir = tmpTree(['a.js']);
  ws.setBackupDir(fs.mkdtempSync(path.join(os.tmpdir(), 'via-bak-')));
  ws.setRoot(dir);
  agent.cancelPending();
  const all = tools.getToolSchemas().map((t) => t.name);
  const seen = script([call('project_list', {}, 'c1'), call('project_read_file', { path: 'a.js' }, 'c2'), { text: 'selesai' }]);
  const out = await agent.startTurn('lihat');
  assert.equal(out.done, true);
  assert.equal(seen.length, 3);
  for (const s of seen) assert.deepEqual(s.tools.map((t) => t.name), all);
  ws.clearRoot();
});

test('tanpa folder proyek: tool proyek tetap terlihat dan mengembalikan error yang menunjuk pick_source', async () => {
  agent.cancelPending();
  const seen = script([call('project_list', {}), { text: 'oke' }]);
  await agent.startTurn('lihat proyek');
  assert.ok(seen[0].tools.some((t) => t.name === 'project_list'));
  const r = await run('project_list', {});
  assert.match(r.error, /pick_source/);
});
