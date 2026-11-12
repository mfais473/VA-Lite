require('./helpers/stub-modules');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const paths = require('../src/config/paths');
const envStore = require('../src/config/env-store');
const store = require('../src/config/providers-store');
const service = require('../src/config/settings-service');
const { PARAM_KEYS, PARAMS, GROUPS } = require('../src/config/settings/params-schema');
const constants = require('../src/agent/loop/constants');
const gate = require('../src/agent/plan-gate');
const tools = require('../src/tools');

const saved = {};
function setup(envText = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-par-'));
  const file = path.join(dir, '.env');
  if (envText) fs.writeFileSync(file, envText);
  paths.setOverrides({ envPath: file, userDataDir: dir, providersPath: path.join(dir, 'providers.json') });
  store.invalidate();
  for (const k of PARAM_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  return { dir, file };
}
function teardown() {
  for (const k of PARAM_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  paths.setOverrides();
  store.invalidate();
  envStore.__test.resetLoaded();
}

test('skema: setiap kunci unik, punya grup yang ada, dan lolos allowlist', () => {
  assert.equal(new Set(PARAM_KEYS).size, PARAM_KEYS.length);
  const groupIds = GROUPS.map((g) => g.id);
  for (const p of PARAMS) {
    assert.ok(groupIds.includes(p.group), p.key);
    assert.ok(envStore.isAllowedKey(p.key), p.key);
  }
});

test('skema: semua variabel VIA_* di .env.example tercakup (kecuali batas keluaran yang punya layar sendiri)', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
  const found = new Set([...text.matchAll(/^#?\s*(VIA_[A-Z_]+)=/gm)].map((m) => m[1]));
  const own = new Set(['VIA_MAX_OUTPUT_TOKENS', 'VIA_MAX_OUTPUT_TOKENS_CODING']);
  for (const k of found) assert.ok(PARAM_KEYS.includes(k) || own.has(k) || k.startsWith('VIA_PROVIDER_'), `${k} belum bisa diatur dari UI`);
});

test('getParams: nilai kosong bila belum diset, nilai env bila ada', () => {
  setup();
  try {
    process.env.VIA_MAX_CODING_STEPS = '30';
    const r = service.getParams();
    assert.equal(r.ok, true);
    const all = r.groups.flatMap((g) => g.params);
    assert.equal(all.length, PARAMS.length);
    assert.equal(all.find((p) => p.key === 'VIA_MAX_CODING_STEPS').value, '30');
    assert.equal(all.find((p) => p.key === 'VIA_MAX_AGENT_STEPS').value, '');
    assert.equal(all.find((p) => p.key === 'VIA_MAX_AGENT_STEPS').default, '6');
  } finally { teardown(); }
});

test('saveParams: tersimpan di .env, berlaku langsung tanpa restart, baris lain utuh', () => {
  const { file } = setup('# catatan\nLLM_PROVIDER=anoman\nANOMAN_API_KEY=anm-rahasia-12345\nVIA_MAX_AGENT_STEPS=4\n');
  try {
    envStore.load({ force: true });
    assert.equal(constants.MAX_STEPS, 4);
    const r = service.saveParams({ values: { VIA_MAX_AGENT_STEPS: '10', VIA_MAX_CODING_STEPS: '40', VIA_PLAN_TTL_MIN: '30', VIA_READ_MAX_CHARS: '20000' } });
    assert.equal(r.ok, true);
    assert.equal(constants.MAX_STEPS, 10);
    assert.equal(constants.MAX_CODING_STEPS, 40);
    assert.equal(gate.PLAN_TTL_MS, 30 * 60 * 1000);
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, /VIA_MAX_AGENT_STEPS=10/);
    assert.match(text, /VIA_READ_MAX_CHARS=20000/);
    assert.ok(text.includes('# catatan') && text.includes('ANOMAN_API_KEY=anm-rahasia-12345') && text.includes('LLM_PROVIDER=anoman'));
  } finally { teardown(); }
});

test('saveParams: nilai kosong menghapus baris dan kembali ke default', () => {
  const { file } = setup('VIA_MAX_AGENT_STEPS=10\nVIA_TPM_LIMIT=40000\n');
  try {
    envStore.load({ force: true });
    const r = service.saveParams({ values: { VIA_MAX_AGENT_STEPS: '', VIA_TPM_LIMIT: '  ' } });
    assert.equal(r.ok, true);
    assert.equal(constants.MAX_STEPS, 6);
    assert.equal(process.env.VIA_TPM_LIMIT, undefined);
    assert.ok(!/VIA_/.test(fs.readFileSync(file, 'utf8')));
  } finally { teardown(); }
});

test('saveParams: nilai buruk ditolak seluruhnya tanpa mengubah apa pun', () => {
  const { file } = setup('VIA_MAX_AGENT_STEPS=7\n');
  try {
    envStore.load({ force: true });
    const before = fs.readFileSync(file, 'utf8');
    const bads = [
      { VIA_MAX_AGENT_STEPS: 'abc' }, { VIA_MAX_AGENT_STEPS: '0' }, { VIA_MAX_AGENT_STEPS: '51' }, { VIA_MAX_AGENT_STEPS: '-3' },
      { VIA_MAX_AGENT_STEPS: '1e2' }, { VIA_READ_MAX_CHARS: '100' }, { VIA_RATE_RETRY_MAX: '11' },
      { VIA_TRANSIENT_RETRY_STATUSES: '200' }, { VIA_TRANSIENT_RETRY_STATUSES: '503,abc' },
      { VIA_DEVTOOLS: 'yes' }, { LLM_PROVIDER: 'x' }, { VIA_TIDAK_ADA: '1' }, { VIA_MAX_AGENT_STEPS: 5 }, { VIA_MAX_AGENT_STEPS: null },
    ];
    for (const values of bads) {
      const r = service.saveParams({ values: { VIA_MAX_CODING_STEPS: '33', ...values } });
      assert.equal(r.ok, false, JSON.stringify(values));
    }
    for (const junk of [undefined, null, 5, 'x', [], {}, { values: [] }, { values: null }, { values: {} }]) {
      assert.equal(service.saveParams(junk).ok, false, JSON.stringify(junk));
    }
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    assert.equal(process.env.VIA_MAX_CODING_STEPS, undefined);
    assert.equal(process.env.VIA_MAX_AGENT_STEPS, '7');
  } finally { teardown(); }
});

test('saveParams: status retry dinormalkan, folder dan alat divalidasi', () => {
  const { file } = setup();
  try {
    const dir = path.resolve(os.tmpdir());
    const r = service.saveParams({ values: {
      VIA_TRANSIENT_RETRY_STATUSES: '503, 504 503',
      VIA_ALLOWED_DIRS: `${dir}\n${dir}\n/tmp/lain;C:\\Users\\Nama\\Documents`,
      VIA_AUTO_TOOLS: 'open_browser, find_files',
      VIA_DEVTOOLS: '1',
    } });
    assert.equal(r.ok, true, r.error);
    assert.equal(process.env.VIA_TRANSIENT_RETRY_STATUSES, '503,504');
    assert.equal(process.env.VIA_ALLOWED_DIRS, `${dir};/tmp/lain;C:\\Users\\Nama\\Documents`);
    assert.equal(process.env.VIA_AUTO_TOOLS, 'open_browser,find_files');
    assert.equal(process.env.VIA_DEVTOOLS, '1');
    assert.match(fs.readFileSync(file, 'utf8'), /VIA_DEVTOOLS=1/);

    assert.equal(service.saveParams({ values: { VIA_DEVTOOLS: '' } }).ok, true);
    assert.equal(process.env.VIA_DEVTOOLS, undefined);

    for (const bad of ['relatif/folder', '~/Documents', '/ok,/koma', `${dir}\u0007`]) {
      assert.equal(service.saveParams({ values: { VIA_ALLOWED_DIRS: bad } }).ok, false, bad);
    }
    for (const bad of ['alat_tidak_ada', 'Open-Browser', 'apply_patch', 'project_write_file', 'edit_excel', 'project_propose_plan']) {
      assert.equal(service.saveParams({ values: { VIA_AUTO_TOOLS: bad } }).ok, false, bad);
    }
    assert.equal(process.env.VIA_AUTO_TOOLS, 'open_browser,find_files', 'penolakan tidak mengubah nilai lama');
  } finally { teardown(); }
});

test('VIA_AUTO_TOOLS dari pengaturan berlaku langsung pada permissionOf, alat wajib-konfirmasi tetap confirm', () => {
  setup();
  try {
    const openBrowser = tools.getTool('open_browser');
    const applyTool = tools.getTool('apply_patch');
    const before = tools.permissionOf(openBrowser);
    assert.equal(service.saveParams({ values: { VIA_AUTO_TOOLS: 'read_pdf' } }).ok, true);
    assert.equal(tools.permissionOf(tools.getTool('read_pdf')), 'auto');
    process.env.VIA_AUTO_TOOLS = 'apply_patch';
    assert.equal(tools.permissionOf(applyTool), 'confirm');
    assert.ok(before === 'auto' || before === 'confirm');
  } finally { teardown(); }
});

test('IPC: get-params dan save-params hanya dari jendela utama', async () => {
  setup();
  try {
    const { registerSettingsHandlers } = require('../src/core/settings-ipc');
    const handlers = {};
    const main = { id: 'main' };
    const win = { webContents: main, isDestroyed: () => false };
    registerSettingsHandlers({ ipcMain: { handle: (c, f) => { handlers[c] = f; } }, getMainWindow: () => win, isBusy: () => false, hasPending: () => false });
    assert.deepEqual(await handlers['settings:get-params']({ sender: { id: 'lain' } }, {}), { ok: false, error: 'Tidak diizinkan' });
    assert.deepEqual(await handlers['settings:save-params']({ sender: { id: 'lain' } }, { data: { values: { VIA_DEVTOOLS: '1' } } }), { ok: false, error: 'Tidak diizinkan' });
    assert.equal(process.env.VIA_DEVTOOLS, undefined);
    assert.equal((await handlers['settings:get-params']({ sender: main }, {})).ok, true);
    for (const junk of [undefined, null, 5, 'x', [], { data: 'x' }]) {
      assert.equal((await handlers['settings:save-params']({ sender: main }, junk)).ok, false);
    }
    const ok = await handlers['settings:save-params']({ sender: main }, { data: { values: { VIA_RATE_RETRY_MAX: '2' } } });
    assert.equal(ok.ok, true);
    assert.equal(process.env.VIA_RATE_RETRY_MAX, '2');
    delete process.env.VIA_RATE_RETRY_MAX;
  } finally { teardown(); }
});
