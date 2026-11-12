require('./helpers/stub-modules');
process.env.VIA_AUTO_TOOLS = '';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const paths = require('../src/config/paths');
const envStore = require('../src/config/env-store');
const store = require('../src/config/providers-store');
const clients = require('../src/ai/providers/clients');
const registry = require('../src/ai/providers');
const service = require('../src/config/settings-service');
const llm = require('../src/ai/llm-client');
const { registerSettingsHandlers } = require('../src/core/settings-ipc');

const MANAGED = ['LLM_PROVIDER', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'ANOMAN_API_KEY',
  'ANOMAN_BASE_URL', 'ANOMAN_MODEL_PRIMARY', 'ANOMAN_MODEL_FOLLOWUP', 'ANOMAN_MODEL_CODING', 'CLAUDE_MODEL_PRIMARY', 'OPENAI_BASE_URL',
  'GEMINI_MODEL_PRIMARY', 'VIA_PROVIDER_MY_LLM_API_KEY', 'VIA_PROVIDER_LOKAL_API_KEY'];

function setup(envText = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-set-'));
  const file = path.join(dir, '.env');
  if (envText) fs.writeFileSync(file, envText);
  paths.setOverrides({ envPath: file, userDataDir: dir, providersPath: path.join(dir, 'providers.json') });
  store.invalidate();
  for (const k of MANAGED) delete process.env[k];
  clients.setFactoriesForTest();
  return { dir, file };
}
const teardown = () => { for (const k of MANAGED) delete process.env[k]; paths.setOverrides(); store.invalidate(); clients.setFactoriesForTest(); };
const idle = { isBusy: () => false, hasPending: () => false };
const okOpenAI = (log) => ({ chat: { completions: { create: async (b) => { log && log.push(b); return { choices: [{ finish_reason: 'stop', message: { content: 'ok' } }], usage: {} }; } } } });
const okAnthropic = (log) => ({ messages: { create: async (b) => { log && log.push(b); return { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: {} }; } } });

const SECRETS = ['sk-ant-SECRET-AAAA1111', 'sk-oai-SECRET-BBBB2222', 'ds-SECRET-CCCC3333', 'custom-SECRET-DDDD4444', 'anm-SECRET-EEEE5555', 'AIzaSECRETFFFF66667777888899'];

test('migrasi .env lama: LLM_PROVIDER=anoman + ANOMAN_* + GEMINI_* tetap berfungsi tanpa perubahan', () => {
  setup('LLM_PROVIDER=anoman\nANOMAN_API_KEY=anm-lama-12345\nANOMAN_BASE_URL=https://proxy.example.com/v1\nANOMAN_MODEL_PRIMARY=claude-haiku-4-5\nGEMINI_API_KEY=g-lama-12345\n');
  try {
    envStore.load({ force: true });
    const cfg = registry.resolve();
    assert.equal(cfg.id, 'anoman');
    assert.equal(cfg.protocol, 'openai');
    assert.equal(cfg.baseURL, 'https://proxy.example.com/v1');
    assert.equal(cfg.apiKey, 'anm-lama-12345');
    assert.deepEqual(cfg.models, { primary: 'claude-haiku-4-5', followUp: 'gpt-4o-mini', coding: 'gpt-4o-mini' });
    assert.equal(registry.resolve('gemini').apiKey, 'g-lama-12345');
    assert.equal(registry.resolve('gemini').models.coding, 'gemini-2.0-flash');
    assert.equal(fs.readFileSync(paths.envPath(), 'utf8').startsWith('LLM_PROVIDER=anoman'), true);
  } finally { teardown(); envStore.__test.resetLoaded(); }
});

test('preset: default terverifikasi (baseURL, model sama di tiga fase, parameter token, thinking DeepSeek)', () => {
  setup();
  try {
    const p = (id) => registry.resolve(id);
    assert.deepEqual([p('claude').baseURL, p('claude').protocol, new Set(Object.values(p('claude').models)).size], ['https://api.anthropic.com', 'anthropic', 1]);
    assert.equal(p('claude').models.primary, 'claude-sonnet-5-5');
    assert.equal(p('openai').models.coding, 'gpt-5.5');
    assert.equal(p('openai').tokenParam, 'max_completion_tokens');
    assert.equal(p('deepseek').baseURL, 'https://api.deepseek.com');
    assert.equal(p('deepseek').models.primary, 'deepseek-flash');
    assert.deepEqual(p('deepseek').extraBody, { thinking: { type: 'disabled' } });
    assert.equal(p('anoman').tokenParam, 'max_tokens');
  } finally { teardown(); }
});

test('getState: tidak pernah memuat kunci (pindai string), hanya hasKey boolean', () => {
  setup();
  try {
    service.addCustom({ id: 'my-llm', label: 'My LLM', protocol: 'openai', baseURL: 'https://api.example.com/v1',
      models: { primary: 'a', followUp: 'b', coding: 'c' }, capabilities: { images: true, tools: true }, apiKey: SECRETS[3] });
    service.save('claude', { apiKey: SECRETS[0] }, idle);
    service.save('openai', { apiKey: SECRETS[1] }, idle);
    service.save('deepseek', { apiKey: SECRETS[2] }, idle);
    service.save('anoman', { apiKey: SECRETS[4] }, idle);
    service.save('gemini', { apiKey: SECRETS[5] }, idle);
    const s = service.getState();
    const dump = JSON.stringify(s);
    for (const k of SECRETS) assert.ok(!dump.includes(k), `kunci bocor: ${k.slice(0, 8)}`);
    assert.ok(!dump.toLowerCase().includes('apikey'));
    assert.deepEqual(s.providers.map((p) => p.id), ['claude', 'openai', 'deepseek', 'gemini', 'anoman', 'my-llm']);
    for (const p of s.providers) assert.equal(p.hasKey, true, p.id);
    assert.equal(typeof s.providers[0].hasKey, 'boolean');
    for (const r of [service.save('claude', { models: { primary: 'x-1' } }, idle), service.setActive('claude', idle)]) {
      for (const k of SECRETS) assert.ok(!JSON.stringify(r).includes(k));
    }
  } finally { teardown(); }
});

test('save: kunci kosong = tidak berubah; kunci/URL/model divalidasi; berlaku langsung di process.env dan .env', () => {
  const { file } = setup('# catatan\nVIA_AUTO_TOOLS=open_browser\n');
  try {
    assert.equal(service.save('openai', { apiKey: 'sk-oai-AAAA1111' }, idle).ok, true);
    assert.equal(service.save('openai', { apiKey: '   ' }, idle).ok, true);
    assert.equal(process.env.OPENAI_API_KEY, 'sk-oai-AAAA1111');
    assert.equal(service.save('openai', { apiKey: 'a\nB_API_KEY=x' }, idle).ok, false);
    assert.equal(service.save('openai', { baseURL: 'http://evil.example.com' }, idle).ok, false);
    assert.equal(service.save('openai', { models: { primary: 'bad model!' } }, idle).ok, false);
    assert.equal(service.save('gemini', { baseURL: 'https://x.example.com' }, idle).ok, false);
    assert.equal(service.save('nope', {}, idle).ok, false);
    assert.equal(service.save('openai', { baseURL: 'https://gw.example.com/v1', models: { coding: 'gpt-5.5-mini-x' } }, idle).ok, true);
    assert.equal(registry.resolve('openai').baseURL, 'https://gw.example.com/v1');
    assert.equal(registry.resolve('openai').models.coding, 'gpt-5.5-mini-x');
    assert.equal(service.save('openai', { baseURL: '', models: { coding: '' } }, idle).ok, true);
    assert.equal(registry.resolve('openai').baseURL, 'https://api.openai.com/v1');
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(text.startsWith('# catatan\nVIA_AUTO_TOOLS=open_browser\n'));
    assert.ok(!text.includes('OPENAI_BASE_URL'));
  } finally { teardown(); }
});

test('setActive: ditolak saat agen sibuk atau ada izin menunggu; berhasil saat idle; menulis LLM_PROVIDER', () => {
  const { file } = setup();
  try {
    const busy = service.setActive('claude', { isBusy: () => true, hasPending: () => false });
    assert.equal(busy.ok, false);
    assert.equal(busy.busy, true);
    const pend = service.setActive('claude', { isBusy: () => false, hasPending: () => true });
    assert.equal(pend.ok, false);
    assert.equal(process.env.LLM_PROVIDER, undefined);
    assert.ok(!fs.existsSync(file));
    const r = service.setActive('claude', idle);
    assert.equal(r.ok, true);
    assert.ok(r.warning, 'peringatan bila kunci belum diisi');
    assert.equal(process.env.LLM_PROVIDER, 'claude');
    assert.match(fs.readFileSync(file, 'utf8'), /^LLM_PROVIDER=claude\n$/);
    assert.equal(service.setActive('tidak-ada', idle).ok, false);
  } finally { teardown(); }
});

test('mutasi provider AKTIF ditolak saat sibuk/pending (save, removeCustom); provider lain boleh', () => {
  setup();
  try {
    service.addCustom({ id: 'my-llm', label: 'My', protocol: 'openai', baseURL: 'https://a.example.com/v1',
      models: { primary: 'a', followUp: 'b', coding: 'c' }, capabilities: {}, apiKey: 'custom-key-123456' });
    service.setActive('my-llm', idle);
    const busy = { isBusy: () => true, hasPending: () => false };
    assert.equal(service.save('my-llm', { models: { primary: 'z' } }, busy).ok, false);
    assert.equal(service.removeCustom('my-llm', busy).ok, false);
    assert.equal(store.get('my-llm').models.primary, 'a');
    assert.equal(service.save('openai', { apiKey: 'sk-oai-AAAA1111' }, busy).ok, true);
    assert.equal(service.save('my-llm', { models: { primary: 'z' } }, idle).ok, true);
  } finally { teardown(); }
});

test('addCustom/removeCustom: kunci di .env sebagai VIA_PROVIDER_<ID>_API_KEY, providers.json tanpa rahasia, hapus membersihkan keduanya', () => {
  const { dir, file } = setup();
  try {
    const def = { id: 'my-llm', label: 'My LLM', protocol: 'anthropic', baseURL: 'https://gw.example.com',
      models: { primary: 'a', followUp: 'b', coding: 'c' }, capabilities: { images: false, tools: true } };
    assert.equal(service.addCustom({ ...def, id: 'claude', apiKey: 'x1234567' }).ok, false);
    assert.equal(service.addCustom({ ...def, apiKey: '' }).ok, false, 'kunci wajib untuk host non-lokal');
    assert.equal(service.addCustom({ ...def, baseURL: 'http://evil.example.com', apiKey: 'x1234567' }).ok, false);
    assert.equal(service.addCustom({ ...def, apiKey: 'custom-SECRET-1234' }).ok, true);
    assert.equal(service.addCustom({ ...def, apiKey: 'custom-SECRET-1234' }).ok, false, 'id harus unik');
    assert.match(fs.readFileSync(file, 'utf8'), /VIA_PROVIDER_MY_LLM_API_KEY=custom-SECRET-1234/);
    assert.ok(!fs.readFileSync(path.join(dir, 'providers.json'), 'utf8').includes('SECRET'));
    assert.equal(registry.resolve('my-llm').apiKey, 'custom-SECRET-1234');
    assert.equal(service.removeCustom('openai', idle).ok, false, 'preset tidak bisa dihapus');
    service.setActive('my-llm', idle);
    const r = service.removeCustom('my-llm', idle);
    assert.equal(r.ok, true);
    assert.equal(r.switchedTo, 'gemini');
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!text.includes('VIA_PROVIDER_MY_LLM_API_KEY') && text.includes('LLM_PROVIDER=gemini'));
    assert.equal(process.env.VIA_PROVIDER_MY_LLM_API_KEY, undefined);
    assert.equal(service.addCustom({ ...def, id: 'lokal', protocol: 'openai', baseURL: 'http://localhost:11434/v1', apiKey: '' }).ok, true);
    assert.equal(registry.resolve('lokal').hasKey, true);
    assert.equal(service.getState().providers.find((p) => p.id === 'lokal').hasKey, false, 'UI tidak menganggap placeholder sebagai kunci tersimpan');
  } finally { teardown(); }
});

test('callLLM membaca provider aktif PER PANGGILAN: setActive langsung berlaku di panggilan berikutnya', async () => {
  setup();
  try {
    const logs = { openai: [], anthropic: [] };
    clients.setFactoriesForTest({ openai: () => okOpenAI(logs.openai), anthropic: () => okAnthropic(logs.anthropic) });
    service.save('openai', { apiKey: 'sk-oai-AAAA1111' }, idle);
    service.save('claude', { apiKey: 'sk-ant-AAAA1111' }, idle);
    service.setActive('openai', idle);
    await llm.callLLM({ system: 's', messages: [{ role: 'user', text: 'a' }], phase: 'coding' });
    service.setActive('claude', idle);
    await llm.callLLM({ system: 's', messages: [{ role: 'user', text: 'b' }] });
    assert.equal(logs.openai.length, 1);
    assert.equal(logs.openai[0].model, 'gpt-5.5');
    assert.equal(logs.anthropic.length, 1);
    assert.equal(logs.anthropic[0].model, 'claude-sonnet-5-5');
  } finally { teardown(); }
});

test('callLLM anthropic: tools lengkap dikirim sama tiap langkah; langkah tanpa tools -> tool_choice none; rawAnthropic dikembalikan', async () => {
  setup();
  try {
    const bodies = [];
    const content = [{ type: 'thinking', thinking: 't', signature: 's' }, { type: 'tool_use', id: 'u1', name: 'project_list', input: {} }];
    clients.setFactoriesForTest({ anthropic: () => ({ messages: { create: async (b) => { bodies.push(JSON.parse(JSON.stringify(b))); return { content, stop_reason: 'tool_use', usage: {} }; } } }) });
    service.save('claude', { apiKey: 'sk-ant-AAAA1111' }, idle);
    service.setActive('claude', idle);
    const full = [{ name: 'a', description: 'a', parameters: { type: 'object', properties: {} } }, { name: 'b', description: 'b', parameters: { type: 'object', properties: {} } }];
    const r1 = await llm.callLLM({ system: 's', messages: [{ role: 'user', text: 'x' }], tools: [full[0]], stableTools: full });
    await llm.callLLM({ system: 's', messages: [{ role: 'user', text: 'x' }], tools: [], stableTools: full });
    assert.deepEqual(bodies[0].tools, bodies[1].tools);
    assert.equal(bodies[0].tools.length, 2);
    assert.equal(bodies[0].tool_choice, undefined);
    assert.deepEqual(bodies[1].tool_choice, { type: 'none' });
    assert.equal(r1.usedStableTools, true);
    assert.equal(r1.rawAnthropic, content);
  } finally { teardown(); }
});

test('sanitasi: kunci tidak muncul di error callLLM, di log konsol, atau di hasil test()', async () => {
  setup();
  const logged = [];
  const origErr = console.error; const origWarn = console.warn; const origLog = console.log;
  console.error = (...a) => logged.push(a.join(' ')); console.warn = console.error; console.log = console.error;
  try {
    const KEY = 'sk-ant-SECRET-LEAK-9999';
    clients.setFactoriesForTest({ anthropic: () => ({ messages: { create: async () => {
      throw Object.assign(new Error(`401 invalid x-api-key ${KEY} (Authorization: Bearer ${KEY})`), { status: 401, headers: { 'x-api-key': KEY } });
    } } }) });
    service.save('claude', { apiKey: KEY }, idle);
    service.setActive('claude', idle);
    let caught;
    try { await llm.callLLM({ system: 's', messages: [{ role: 'user', text: 'a' }] }); } catch (e) { caught = e; }
    assert.ok(caught);
    assert.ok(!caught.message.includes('SECRET-LEAK') && !String(caught.stack).includes('SECRET-LEAK'));
    assert.equal(caught.kind, 'auth');
    assert.equal(caught.cause, undefined);
    const t = await service.test('claude');
    assert.equal(t.ok, false);
    assert.equal(t.errorKind, 'auth');
    assert.ok(!JSON.stringify(t).includes('SECRET-LEAK'));
    assert.ok(!logged.join('\n').includes('SECRET-LEAK'), 'log tidak boleh memuat kunci');
  } finally { console.error = origErr; console.warn = origWarn; console.log = origLog; teardown(); }
});

test('test(): ping + probe tool-call; toolsOk true/false; tanpa kunci -> auth', async () => {
  setup();
  try {
    assert.equal((await service.test('openai')).errorKind, 'auth');
    service.save('openai', { apiKey: 'sk-oai-AAAA1111' }, idle);
    const calls = [];
    let withTool = true;
    clients.setFactoriesForTest({ openai: () => ({ chat: { completions: { create: async (b) => {
      calls.push(b);
      if (b.tools && withTool) return { choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'p', function: { name: 'ping_tool', arguments: '{"value":"ok"}' } }] } }] };
      return { choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] };
    } } } }) });
    let r = await service.test('openai');
    assert.deepEqual([r.ok, r.toolsOk, typeof r.latencyMs], [true, true, 'number']);
    assert.equal(calls[0].max_completion_tokens, 64);
    assert.equal(calls[0].tools, undefined);
    withTool = false;
    r = await service.test('openai');
    assert.deepEqual([r.ok, r.toolsOk], [true, false]);
  } finally { teardown(); }
});

test('IPC pengaturan: hanya jendela utama; payload sembarang tidak membuat crash; kesalahan internal tanpa detail', async () => {
  setup();
  try {
    const handlers = {};
    const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
    const mainSender = { id: 'main' };
    const win = { webContents: mainSender, isDestroyed: () => false };
    registerSettingsHandlers({ ipcMain, getMainWindow: () => win, isBusy: () => false, hasPending: () => false });
    assert.deepEqual(Object.keys(handlers).sort(), ['settings:add-custom', 'settings:get-limits', 'settings:get-params', 'settings:get-state', 'settings:remove-custom', 'settings:save', 'settings:save-limits', 'settings:save-params', 'settings:set-active', 'settings:test']);
    for (const ch of Object.keys(handlers)) {
      assert.deepEqual(await handlers[ch]({ sender: { id: 'lain' } }, {}), { ok: false, error: 'Tidak diizinkan' }, ch);
      assert.deepEqual(await handlers[ch]({ sender: mainSender, senderFrame: { parent: {} } }, {}), { ok: false, error: 'Tidak diizinkan' }, ch);
    }
    const st = await handlers['settings:get-state']({ sender: mainSender }, undefined);
    assert.equal(st.ok, true);
    for (const junk of [undefined, null, 5, 'x', [], { providerId: { a: 1 }, data: 'x' }]) {
      for (const ch of ['settings:save', 'settings:set-active', 'settings:add-custom', 'settings:remove-custom']) {
        const r = await handlers[ch]({ sender: mainSender }, junk);
        assert.equal(r.ok, false, ch);
      }
    }
    const boom = {};
    registerSettingsHandlers({ ipcMain: { handle: (c, f) => { boom[c] = f; } }, getMainWindow: () => win, isBusy: () => false, hasPending: () => false,
      service: { getState: () => { throw new Error('kunci sk-RAHASIA-1 bocor'); } } });
    const r = await boom['settings:get-state']({ sender: mainSender }, {});
    assert.equal(r.ok, false);
    assert.ok(!JSON.stringify(r).includes('RAHASIA'));
    const busyHandlers = {};
    registerSettingsHandlers({ ipcMain: { handle: (c, f) => { busyHandlers[c] = f; } }, getMainWindow: () => win, isBusy: () => true, hasPending: () => false });
    assert.equal((await busyHandlers['settings:set-active']({ sender: mainSender }, { providerId: 'claude' })).busy, true);
  } finally { teardown(); }
});
