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
const ol = require('../src/ai/output-limit');
const llm = require('../src/ai/llm-client');

const KEYS = ['VIA_MAX_OUTPUT_TOKENS', 'VIA_MAX_OUTPUT_TOKENS_CODING'];
const clearEnv = () => { for (const k of KEYS) delete process.env[k]; };

function setup(envText = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-lim-'));
  const file = path.join(dir, '.env');
  if (envText) fs.writeFileSync(file, envText);
  paths.setOverrides({ envPath: file, userDataDir: dir, providersPath: path.join(dir, 'providers.json') });
  store.invalidate();
  clearEnv();
  return { dir, file };
}
const teardown = () => { clearEnv(); paths.setOverrides(); store.invalidate(); envStore.__test.resetLoaded(); };

test('parseLimit: kosong/default/0/teks aneh = Default; angka positif = Custom', () => {
  for (const raw of [undefined, null, '', '  ', 'default', 'DEFAULT', '0', 'abc', '-', '0.4']) {
    assert.deepEqual(ol.parseLimit(raw), { mode: 'default', value: null }, String(raw));
  }
  assert.deepEqual(ol.parseLimit('16000'), { mode: 'custom', value: 16000 });
  assert.deepEqual(ol.parseLimit(' 30000 '), { mode: 'custom', value: 30000 });
  assert.deepEqual(ol.parseLimit('1500.9'), { mode: 'custom', value: 1500 });
});

test('maxOutputTokens: Default = 0 (tidak dikirim); variabel coding menimpa yang umum hanya pada fase coding', () => {
  assert.equal(ol.maxOutputTokens('primary', {}), 0);
  assert.equal(ol.maxOutputTokens('coding', {}), 0);
  assert.equal(ol.maxOutputTokens('coding', { VIA_MAX_OUTPUT_TOKENS: '30000' }), 30000);
  assert.equal(ol.maxOutputTokens('primary', { VIA_MAX_OUTPUT_TOKENS: '30000', VIA_MAX_OUTPUT_TOKENS_CODING: '8000' }), 30000);
  assert.equal(ol.maxOutputTokens('coding', { VIA_MAX_OUTPUT_TOKENS: '30000', VIA_MAX_OUTPUT_TOKENS_CODING: '8000' }), 8000);
  assert.equal(ol.maxOutputTokens('coding', { VIA_MAX_OUTPUT_TOKENS: '30000', VIA_MAX_OUTPUT_TOKENS_CODING: '' }), 30000);
});

test('llm-client memakai output-limit: Default tidak mengirim batas, Custom mengirim angkanya', () => {
  clearEnv();
  assert.equal(llm.__test.maxOutputTokens('coding'), 0);
  process.env.VIA_MAX_OUTPUT_TOKENS = '12000';
  try {
    assert.equal(llm.__test.maxOutputTokens('coding'), 12000);
    assert.match(llm.describeOutputLimit('coding'), /12000 token/);
  } finally { clearEnv(); }
  assert.match(llm.describeOutputLimit('coding'), /Default/);
});

test('validateCustom: bilangan bulat dalam rentang', () => {
  assert.deepEqual(ol.validateCustom('16000'), { ok: true, value: 16000 });
  assert.deepEqual(ol.validateCustom(30000), { ok: true, value: 30000 });
  for (const bad of ['', 'abc', '-', '12.5', '999', '1000001', '-5', null, undefined, {}, [], '1e5']) {
    assert.equal(ol.validateCustom(bad).ok, false, String(bad));
  }
});

test('allowlist: kunci batas keluaran dan parameter terdaftar boleh disimpan, variabel Via lain tetap tidak', () => {
  assert.ok(envStore.isAllowedKey('VIA_MAX_OUTPUT_TOKENS'));
  assert.ok(envStore.isAllowedKey('VIA_MAX_OUTPUT_TOKENS_CODING'));
  for (const k of ['VIA_TPM_LIMIT', 'VIA_AUTO_TOOLS', 'VIA_ALLOWED_DIRS']) assert.ok(envStore.isAllowedKey(k), k);
  for (const k of ['VIA_MAX_OUTPUT_TOKENS_X', 'VIA_TIDAK_ADA', 'PATH', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE']) assert.ok(!envStore.isAllowedKey(k), k);
});

test('saveLimits custom: tersimpan di .env, berlaku langsung, baris coding lama ikut dihapus, baris lain utuh', () => {
  const { file } = setup('# catatan\nLLM_PROVIDER=anoman\nVIA_MAX_OUTPUT_TOKENS=8000\nVIA_MAX_OUTPUT_TOKENS_CODING=8000\nANOMAN_API_KEY=anm-rahasia-12345\n');
  try {
    envStore.load({ force: true });
    assert.equal(process.env.VIA_MAX_OUTPUT_TOKENS_CODING, '8000');
    const before = service.getLimits();
    assert.equal(before.limits.mode, 'custom');
    assert.ok(before.limits.codingOverride, 'penimpaan coding terdeteksi');

    const r = service.saveLimits({ mode: 'custom', value: '30000' });
    assert.equal(r.ok, true);
    assert.deepEqual([r.limits.mode, r.limits.value, r.limits.codingOverride], ['custom', 30000, null]);
    assert.equal(llm.__test.maxOutputTokens('coding'), 30000, 'fase coding tidak lagi tertahan 8000');
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, /VIA_MAX_OUTPUT_TOKENS=30000/);
    assert.ok(!text.includes('VIA_MAX_OUTPUT_TOKENS_CODING'));
    assert.ok(text.includes('# catatan') && text.includes('ANOMAN_API_KEY=anm-rahasia-12345'));
  } finally { teardown(); }
});

test('saveLimits default: kedua baris dihapus; nilai tidak valid ditolak tanpa mengubah apa pun', () => {
  const { file } = setup('VIA_MAX_OUTPUT_TOKENS=16000\nGEMINI_API_KEY=g-12345678\n');
  try {
    envStore.load({ force: true });
    for (const bad of [{ mode: 'custom', value: 'abc' }, { mode: 'custom', value: '10' }, { mode: 'custom' }, { mode: 'x' }, null, 5]) {
      const r = service.saveLimits(bad);
      assert.equal(r.ok, false, JSON.stringify(bad));
    }
    assert.match(fs.readFileSync(file, 'utf8'), /VIA_MAX_OUTPUT_TOKENS=16000/);
    assert.equal(process.env.VIA_MAX_OUTPUT_TOKENS, '16000');

    const r = service.saveLimits({ mode: 'default' });
    assert.equal(r.ok, true);
    assert.deepEqual([r.limits.mode, r.limits.value], ['default', null]);
    assert.equal(llm.__test.maxOutputTokens('coding'), 0);
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!text.includes('VIA_MAX_OUTPUT_TOKENS'));
    assert.ok(text.includes('GEMINI_API_KEY=g-12345678'));
  } finally { teardown(); }
});

test('getLimits: pengaturan lama berupa angka dibaca sebagai Custom; tanpa pengaturan = Default', () => {
  setup();
  try {
    assert.equal(service.getLimits().limits.mode, 'default');
    process.env.VIA_MAX_OUTPUT_TOKENS = '8000';
    const l = service.getLimits().limits;
    assert.deepEqual([l.mode, l.value, l.min, l.max], ['custom', 8000, ol.MIN_CUSTOM, ol.MAX_CUSTOM]);
  } finally { teardown(); }
});

test('saveLimits: batas khusus coding bisa diisi, dibaca kembali, dan dihapus lagi', () => {
  const { file } = setup('VIA_MAX_OUTPUT_TOKENS=8000\n');
  try {
    envStore.load({ force: true });
    assert.deepEqual(service.getLimits().limits.coding, { mode: 'inherit', value: null });
    const r = service.saveLimits({ mode: 'custom', value: '16000', coding: { mode: 'custom', value: '32000' } });
    assert.equal(r.ok, true);
    assert.deepEqual(r.limits.coding, { mode: 'custom', value: 32000 });
    assert.equal(llm.__test.maxOutputTokens('coding'), 32000);
    assert.equal(llm.__test.maxOutputTokens('primary'), 16000);
    assert.match(fs.readFileSync(file, 'utf8'), /VIA_MAX_OUTPUT_TOKENS_CODING=32000/);

    assert.equal(service.saveLimits({ mode: 'custom', value: '16000', coding: { mode: 'custom', value: '5' } }).ok, false);
    assert.equal(service.saveLimits({ mode: 'custom', value: '16000', coding: { mode: 'x' } }).ok, false);
    assert.equal(process.env.VIA_MAX_OUTPUT_TOKENS_CODING, '32000', 'penolakan tidak mengubah apa pun');

    const back = service.saveLimits({ mode: 'custom', value: '16000', coding: { mode: 'inherit' } });
    assert.deepEqual(back.limits.coding, { mode: 'inherit', value: null });
    assert.ok(!fs.readFileSync(file, 'utf8').includes('VIA_MAX_OUTPUT_TOKENS_CODING'));
  } finally { teardown(); }
});
