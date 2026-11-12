require('./helpers/stub-modules');
process.env.VIA_AUTO_TOOLS = '';
const test = require('node:test');
const assert = require('node:assert/strict');
const llm = require('../src/ai/llm-client');
const agent = require('../src/agent/agent-loop');
const clients = require('../src/ai/providers/clients');
const openai = require('../src/ai/providers/openai');
const usage = require('../src/ai/usage-log');
const rh = require('../src/ai/rate-headers');
const { createRateLimitRetry } = require('../src/ai/rate-limit-retry');

function script(items) {
  const seen = [];
  let i = 0;
  llm.callLLM = async (opts) => {
    seen.push({ phase: opts.phase, messages: opts.messages.slice() });
    const item = items[Math.min(i++, items.length - 1)];
    return { text: '', toolCalls: [], ...item };
  };
  return seen;
}
const clearLimits = () => { delete process.env.VIA_MAX_OUTPUT_TOKENS; delete process.env.VIA_MAX_OUTPUT_TOKENS_CODING; };
const quiet = (fn) => async () => {
  const w = console.warn; const l = console.log;
  console.warn = () => {}; console.log = () => {};
  try { await fn(); } finally { console.warn = w; console.log = l; agent.cancelPending(); clearLimits(); }
};

test('terpotong tanpa teks dan tanpa tool call: diulang SEKALI dengan catatan, lalu berhasil', quiet(async () => {
  const seen = script([{ truncated: true, text: '' }, { text: 'Selesai.' }]);
  const out = await agent.startTurn('halo');
  assert.equal(out.done, true);
  assert.equal(out.rawText, 'Selesai.');
  assert.equal(seen.length, 2);
  const noteTexts = seen[1].messages.filter((m) => m.role === 'note').map((m) => m.text).join('\n');
  assert.match(noteTexts, /terpotong/);
  assert.ok(!seen[1].messages.some((m) => m.role === 'assistant' && m.text === '' && !(m.toolCalls || []).length),
    'pesan asisten kosong tidak ikut dikirim ulang');
}));

test('terpotong dua kali: berhenti dengan pesan jelas (Default: batas dari penyedia), tanpa panggilan ketiga', quiet(async () => {
  const seen = script([{ truncated: true }, { truncated: true }, { text: 'tidak boleh sampai sini' }]);
  const out = await agent.startTurn('halo');
  assert.equal(seen.length, 2);
  assert.equal(out.done, true);
  assert.match(out.rawText, /terpotong berulang kali/);
  assert.match(out.rawText, /Via tidak mengirim batas/);
  assert.ok(!out.rawText.includes('tidak boleh sampai sini'));
}));

test('terpotong dua kali dengan batas Custom: pesan menyebut angka dan menu pengaturan', quiet(async () => {
  process.env.VIA_MAX_OUTPUT_TOKENS = '12000';
  script([{ truncated: true }, { truncated: true }]);
  const out = await agent.startTurn('halo');
  assert.match(out.rawText, /12000 token/);
  assert.match(out.rawText, /Pengaturan > Batas keluaran model/);
}));

test('terpotong tetapi ADA teks: tetap jawaban parsial + catatan, tanpa pemulihan', quiet(async () => {
  const seen = script([{ truncated: true, text: 'Jawaban setengah' }, { text: 'tidak dipanggil' }]);
  const out = await agent.startTurn('halo');
  assert.equal(seen.length, 1);
  assert.ok(out.rawText.startsWith('Jawaban setengah'));
  assert.match(out.rawText, /terpotong/);
}));

test('argumen tool terpotong: pertama kali model diberi galat dan mencoba lagi; dua kali berturut-turut -> berhenti', quiet(async () => {
  const bad = { truncated: true, toolCalls: [{ id: 't1', name: 'find_files', args: {}, argsError: llm.__test.TRUNCATED_ARGS_ERROR }] };
  const seen = script([bad, { ...bad, toolCalls: [{ ...bad.toolCalls[0], id: 't2' }] }, { text: 'tidak boleh sampai sini' }]);
  const out = await agent.startTurn('cari file');
  assert.equal(seen.length, 2, 'langkah kedua terjadi, ketiga tidak');
  assert.match(out.rawText, /argumen tool tidak lengkap/);
  const toolMsgs = seen[1].messages.filter((m) => m.role === 'tool');
  assert.equal(toolMsgs.length, 1);
  assert.match(toolMsgs[0].text, /terpotong/);
}));

test('argumen terpotong sekali lalu pulih: hitungan berurutan direset', quiet(async () => {
  const bad = { truncated: true, toolCalls: [{ id: 't1', name: 'find_files', args: {}, argsError: llm.__test.TRUNCATED_ARGS_ERROR }] };
  const seen = script([bad, { text: 'Pulih.' }]);
  const out = await agent.startTurn('cari file');
  assert.equal(seen.length, 2);
  assert.equal(out.rawText, 'Pulih.');
}));

test('parseRateHeaders: Headers atau objek biasa; tanpa header -> null; tier disaring', () => {
  const h = new Headers({
    'x-anoman-tier': 'Pro', 'x-anoman-rate-limit-rpm': '120', 'x-anoman-rate-remaining-rpm': '86',
    'x-anoman-rate-limit-tpm': '500000', 'x-anoman-rate-remaining-tpm': '491200',
  });
  const expected = { tier: 'pro', rpmLimit: 120, rpmRemaining: 86, tpmLimit: 500000, tpmRemaining: 491200 };
  assert.deepEqual(rh.parseRateHeaders(h), expected);
  assert.deepEqual(rh.parseRateHeaders({ 'X-Anoman-Tier': 'pro', 'X-Anoman-Rate-Limit-Rpm': '120', 'x-anoman-rate-remaining-rpm': '86',
    'x-anoman-rate-limit-tpm': '500000', 'x-anoman-rate-remaining-tpm': '491200' }), expected);
  assert.equal(rh.parseRateHeaders(new Headers({ 'content-type': 'application/json' })), null);
  assert.equal(rh.parseRateHeaders(undefined), null);
  assert.equal(rh.parseRateHeaders({ 'x-anoman-tier': 'a b<script>' }), null);
  assert.equal(rh.parseRateHeaders({ 'x-anoman-rate-limit-tpm': 'abc' }), null);
});

test('formatRate dan isLow', () => {
  const info = { tier: 'free', rpmLimit: 20, rpmRemaining: 19, tpmLimit: 40000, tpmRemaining: 11000 };
  assert.equal(rh.formatRate(info), '[limit] tier=free | rpm sisa 19/20 | tpm sisa 11000/40000');
  assert.equal(rh.formatRate({ tpmLimit: 40000 }), '[limit] | tpm sisa ?/40000'.replace('[limit] |', '[limit]'));
  assert.equal(rh.isLow(info), true);
  assert.equal(rh.isLow({ ...info, tpmRemaining: 30000 }), false);
  assert.equal(rh.isLow(null), false);
});

test('describeLimitError: kode galat, tier, sisa jatah, retry-after; tanpa isi pesan atau kunci', () => {
  const err = {
    status: 429,
    error: { code: 'rate_limit_exceeded', message: 'kunci sk-RAHASIA-123456 jangan bocor' },
    headers: new Headers({ 'retry-after': '24', 'x-anoman-tier': 'free', 'x-anoman-rate-limit-tpm': '40000', 'x-anoman-rate-remaining-tpm': '0' }),
  };
  const s = rh.describeLimitError(err);
  assert.match(s, /kode=rate_limit_exceeded/);
  assert.match(s, /tier=free/);
  assert.match(s, /tpm 0\/40000/);
  assert.match(s, /retry-after=24s/);
  assert.ok(!s.includes('RAHASIA'));
  assert.match(rh.describeLimitError({ status: 429 }), /tanpa retry-after/);
});

test('log retry 429 memuat ringkasan galat penyedia', async () => {
  const lines = [];
  const w = console.warn;
  console.warn = (m) => lines.push(String(m));
  try {
    const r = createRateLimitRetry({ sleep: async () => {} });
    let n = 0;
    await r.run(async () => {
      n += 1;
      if (n === 1) throw Object.assign(new Error('rate limit'), { status: 429, error: { code: 'rate_limit_exceeded' } });
      return 1;
    });
  } finally { console.warn = w; }
  assert.ok(lines.some((l) => /\[rate-limit\] 429/.test(l) && /kode=rate_limit_exceeded/.test(l) && /tanpa retry-after/.test(l)), lines.join('\n'));
});

const cfg = { id: 'anoman', apiKey: 'anm-test-12345678', baseURL: 'https://api.example.com/v1', capabilities: { tools: true, images: false } };
const okBody = { choices: [{ finish_reason: 'stop', message: { content: 'ok' } }], usage: { prompt_tokens: 5, completion_tokens: 2 } };

test('adapter openai: header x-anoman-* terbaca lewat withResponse; maxTokens 0 tidak mengirim batas', async () => {
  const bodies = [];
  const headers = new Headers({ 'x-anoman-tier': 'free', 'x-anoman-rate-limit-tpm': '40000', 'x-anoman-rate-remaining-tpm': '39000' });
  const client = { chat: { completions: { create: (b) => {
    bodies.push(b);
    const p = Promise.resolve(okBody);
    p.withResponse = async () => ({ data: okBody, response: { headers } });
    return p;
  } } } };
  clients.setFactoriesForTest({ openai: () => client });
  try {
    const a = openai.create(cfg);
    const out = await a.call({ system: 's', messages: [{ role: 'user', text: 'hai' }], model: 'm', maxTokens: 0 });
    assert.deepEqual(out.rate, { tier: 'free', rpmLimit: undefined, rpmRemaining: undefined, tpmLimit: 40000, tpmRemaining: 39000 });
    assert.equal(out.text, 'ok');
    assert.ok(!('max_tokens' in bodies[0]) && !('max_completion_tokens' in bodies[0]));
    await a.call({ system: 's', messages: [{ role: 'user', text: 'hai' }], model: 'm', maxTokens: 20000 });
    assert.equal(bodies[1].max_tokens, 20000);
  } finally { clients.setFactoriesForTest(); }
});

test('adapter openai: klien tanpa withResponse tetap berjalan (rate null)', async () => {
  clients.setFactoriesForTest({ openai: () => ({ chat: { completions: { create: async () => okBody } } }) });
  try {
    const out = await openai.create(cfg).call({ system: 's', messages: [{ role: 'user', text: 'hai' }], model: 'm' });
    assert.equal(out.rate, null);
    assert.equal(out.text, 'ok');
  } finally { clients.setFactoriesForTest(); }
});

test('usage-log: batas TPM dari header menggantikan VIA_TPM_LIMIT; baris [limit] hanya saat berubah atau jatah menipis', () => {
  usage.__test.reset();
  usage.__test.setNow(() => 1_000_000);
  process.env.VIA_TPM_LIMIT = '30000';
  try {
    const rate = { tier: 'free', rpmLimit: 20, rpmRemaining: 19, tpmLimit: 40000, tpmRemaining: 39000 };
    let r = usage.recordUsage({ model: 'm', phase: 'coding', prompt: 10000, completion: 100, rate, maxTokens: 0 });
    assert.match(r.line, /batas-keluaran=default/);
    assert.match(r.limitLine, /tier=free/);
    assert.equal(usage.tpmLimit(), 40000, 'header menang atas VIA_TPM_LIMIT');
    assert.equal(r.warn, null);

    r = usage.recordUsage({ model: 'm', phase: 'coding', prompt: 10000, completion: 100, rate, maxTokens: 0 });
    assert.equal(r.limitLine, null, 'tidak berubah dan jatah masih longgar');

    r = usage.recordUsage({ model: 'm', phase: 'coding', prompt: 14000, completion: 0, rate: { ...rate, tpmRemaining: 5000 }, maxTokens: 0 });
    assert.match(r.limitLine, /tpm sisa 5000\/40000/);
    assert.match(r.warn, /batas 40000 \(penyedia\)/);
  } finally {
    delete process.env.VIA_TPM_LIMIT;
    usage.__test.setNow(() => Date.now());
    usage.__test.reset();
  }
});

test('usage-log: tanpa header memakai VIA_TPM_LIMIT; peringatan saat keluaran mendekati batas keluaran Custom', () => {
  usage.__test.reset();
  usage.__test.setNow(() => 2_000_000);
  process.env.VIA_TPM_LIMIT = '30000';
  try {
    assert.equal(usage.tpmLimit(), 30000);
    const r = usage.recordUsage({ model: 'm', phase: 'coding', prompt: 1000, completion: 7500, maxTokens: 8000 });
    assert.match(r.line, /batas-keluaran=8000/);
    assert.match(r.warns.join('\n'), /94% dari batas keluaran 8000/);
    const ok = usage.recordUsage({ model: 'm', phase: 'coding', prompt: 1000, completion: 100, maxTokens: 8000 });
    assert.ok(!ok.warns.some((w) => /batas keluaran/.test(w)));
  } finally {
    delete process.env.VIA_TPM_LIMIT;
    usage.__test.setNow(() => Date.now());
    usage.__test.reset();
  }
});
