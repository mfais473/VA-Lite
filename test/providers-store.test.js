require('./helpers/stub-modules');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const paths = require('../src/config/paths');
const store = require('../src/config/providers-store');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-ps-'));
  paths.setOverrides({ userDataDir: dir, providersPath: path.join(dir, 'providers.json'), envPath: path.join(dir, '.env') });
  store.invalidate();
  return dir;
}
const def = (o = {}) => ({
  id: 'my-llm', label: 'My LLM', protocol: 'openai', baseURL: 'https://api.example.com/v1',
  models: { primary: 'm-1', followUp: 'm-2', coding: 'm-3' }, capabilities: { images: true, tools: true }, ...o,
});

test('id: pola ^[a-z0-9-]{2,32}$, unik, tidak bentrok preset', () => {
  setup();
  for (const id of ['a', 'Besar', 'ada_garis', 'x'.repeat(33), 'sp asi', '']) assert.ok(!store.validateDef(def({ id })).ok, id);
  for (const id of ['claude', 'openai', 'deepseek', 'gemini', 'anoman']) assert.match(store.validateDef(def({ id })).error, /bawaan/);
  assert.ok(store.validateDef(def({ id: 'ab' })).ok);
  assert.match(store.validateDef(def(), { existingIds: ['my-llm'] }).error, /sudah dipakai/);
});

test('baseURL: https wajib; http hanya localhost/127.0.0.1/[::1]; tanpa kredensial/query', () => {
  assert.ok(store.validateBaseURL('https://api.example.com/v1/').ok);
  assert.equal(store.validateBaseURL('https://api.example.com/v1/').url, 'https://api.example.com/v1');
  for (const u of ['http://localhost:11434/v1', 'http://127.0.0.1:8080', 'http://[::1]:8080/v1']) assert.ok(store.validateBaseURL(u).ok, u);
  for (const u of ['http://example.com/v1', 'ftp://x.com', 'javascript:alert(1)', 'https://u:p@x.com', 'https://x.com/?k=1', 'https://x.com/#a',
    'tidak url', '', 'https://x .com', 'http://localhost.evil.com']) {
    assert.ok(!store.validateBaseURL(u).ok, u);
  }
  assert.equal(store.validateBaseURL('http://localhost:11434/v1').local, true);
  assert.equal(store.validateBaseURL('https://api.example.com').local, false);
});

test('providers.json: tanpa rahasia (kolom tak dikenal, mis. apiKey, dibuang); CRUD tersimpan dan terbaca ulang', () => {
  const dir = setup();
  store.add({ ...def(), apiKey: 'sk-RAHASIA-123456', extra: 'x' });
  const raw = fs.readFileSync(path.join(dir, 'providers.json'), 'utf8');
  assert.ok(!raw.includes('RAHASIA') && !raw.includes('apiKey') && !raw.includes('extra'));
  store.invalidate();
  assert.equal(store.list().length, 1);
  store.update('my-llm', { baseURL: 'https://baru.example.com/api', models: { coding: 'm-9' } });
  store.invalidate();
  assert.equal(store.get('my-llm').baseURL, 'https://baru.example.com/api');
  assert.deepEqual(store.get('my-llm').models, { primary: 'm-1', followUp: 'm-2', coding: 'm-9' });
  store.remove('my-llm');
  assert.equal(store.list().length, 0);
});

test('providers.json rusak atau berisi entri tidak valid: entri dilewati, tidak melempar', () => {
  const dir = setup();
  fs.writeFileSync(path.join(dir, 'providers.json'), JSON.stringify({ version: 1, providers: [def(), def({ id: 'claude' }), def({ id: 'dup' }), def({ id: 'dup' }), { id: 'x' }] }));
  store.invalidate();
  assert.deepEqual(store.list().map((d) => d.id), ['my-llm', 'dup']);
  fs.writeFileSync(path.join(dir, 'providers.json'), '{rusak');
  store.invalidate();
  assert.deepEqual(store.list(), []);
});

test('kunci provider kustom: VIA_PROVIDER_<ID>_API_KEY', () => {
  assert.equal(store.keyEnvFor('my-llm'), 'VIA_PROVIDER_MY_LLM_API_KEY');
});
