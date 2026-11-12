require('./helpers/stub-modules');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ws = require('../src/workspace/workspace');
const tools = require('../src/tools');

const norm = (tool, args) => tools.normalizeArgs(tool, args).args;
const read = tools.getTool('project_read_file');
const list = tools.getTool('project_list');
const search = tools.getTool('project_search');

test('project_* menolak .env walau folder kerja adalah folder VIA sendiri (root proyek)', async () => {
  ws.setBackupDir(fs.mkdtempSync(path.join(os.tmpdir(), 'via-bak-')));
  const viaRoot = path.join(__dirname, '..');
  const res = ws.setRoot(viaRoot);
  assert.ok(res.root, `folder VIA harus bisa dipilih sebagai folder kerja: ${JSON.stringify(res)}`);
  for (const p of ['.env', '.env.local', './.env', '.ENV', '../via/.env']) {
    const r = await read.execute(norm(read, { path: p }));
    assert.equal(r.success, false, p);
    assert.ok(!r.content && !r.text, `${p}: isi tidak boleh keluar`);
  }
  assert.ok(ws.resolveInRoot('.env', 'read').error, 'resolveInRoot menolak .env di root VIA');
});

test('.env di dalam folder kerja: tidak terbaca, tidak terdaftar, tidak ikut pencarian, tidak bisa ditulis/diedit', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-envp-'));
  ws.setBackupDir(fs.mkdtempSync(path.join(os.tmpdir(), 'via-bak-')));
  const root = ws.setRoot(dir).root;
  fs.writeFileSync(path.join(root, '.env'), 'OPENAI_API_KEY=sk-RAHASIA-UNIK-123\n');
  fs.writeFileSync(path.join(root, '.env.local'), 'X_API_KEY=sk-RAHASIA-UNIK-123\n');
  fs.mkdirSync(path.join(root, 'sub'));
  fs.writeFileSync(path.join(root, 'sub', '.env'), 'Y=sk-RAHASIA-UNIK-123\n');
  fs.writeFileSync(path.join(root, 'ok.txt'), 'biasa\n');
  const SECRET = 'sk-RAHASIA-UNIK-123';
  const all = [];
  for (const p of ['.env', '.env.local', 'sub/.env']) all.push(JSON.stringify(await read.execute(norm(read, { path: p }))));
  const listing = JSON.stringify(await list.execute(norm(list, {})));
  const listingSub = JSON.stringify(await list.execute(norm(list, { path: 'sub' })));
  const found = await search.execute(norm(search, { query: 'OPENAI_API_KEY' }));
  all.push(listing, listingSub, JSON.stringify(found));
  for (const out of all) assert.ok(!out.includes(SECRET), 'isi .env bocor');
  assert.ok(!listing.includes('.env'), 'daftar folder tidak menampilkan .env');
  assert.equal(found.matches, 0, 'pencarian tidak menyentuh .env');
  for (const mode of ['write', 'edit']) assert.ok(ws.resolveInRoot('.env', mode).error, mode);
  assert.equal(fs.readFileSync(path.join(root, '.env'), 'utf8'), 'OPENAI_API_KEY=sk-RAHASIA-UNIK-123\n');
});
