require('./helpers/stub-modules');
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const clients = require('../src/ai/providers/clients');
const openaiAdapter = require('../src/ai/providers/openai');
const anthropicAdapter = require('../src/ai/providers/anthropic');
const geminiAdapter = require('../src/ai/providers/gemini');
const { stripImages, classifyCommon, redact } = require('../src/ai/providers/common');

const cfg = (o = {}) => ({ id: 't', apiKey: 'k-test-123456', baseURL: 'https://x.example/v1', tokenParam: 'max_tokens',
  capabilities: { images: true, tools: true }, ...o });
const TOOL = { name: 'project_read_file', description: 'baca', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } };
const IMG = { mimeType: 'image/png', data: 'QUJD' };

const TRANSCRIPT = [
  { role: 'user', text: 'halo' },
  { role: 'assistant', text: 'baik' },
  { role: 'user', text: 'baca dua berkas' },
  { role: 'note', text: '=== KONTEKS SISTEM ===\nfolder: /p' },
  { role: 'assistant', text: 'membaca', toolCalls: [{ id: 'c1', name: 'project_read_file', args: { path: 'a.js' } }, { id: 'c2', name: 'project_read_file', args: { path: 'b.js' } }] },
  { role: 'tool', toolCallId: 'c1', name: 'project_read_file', text: 'isi a' },
  { role: 'tool', toolCallId: 'c2', name: 'project_read_file', text: 'isi b' },
  { role: 'user', text: 'HASIL TOOL: gambar terlampir', images: [IMG] },
];

test('openai: transkrip -> struktur valid (tiap tool_call punya pesan tool; note jadi pesan user)', () => {
  const m = openaiAdapter.toOpenAIMessages('SYS', TRANSCRIPT);
  assert.equal(m[0].role, 'system');
  const asst = m.find((x) => x.tool_calls);
  assert.deepEqual(asst.tool_calls.map((c) => c.id), ['c1', 'c2']);
  const idx = m.indexOf(asst);
  assert.deepEqual(m.slice(idx + 1, idx + 3).map((x) => [x.role, x.tool_call_id]), [['tool', 'c1'], ['tool', 'c2']]);
  assert.ok(m.some((x) => x.role === 'user' && /KONTEKS SISTEM/.test(x.content)));
  assert.equal(JSON.parse(asst.tool_calls[0].function.arguments).path, 'a.js');
  assert.equal(m[m.length - 1].content[1].image_url.url, 'data:image/png;base64,QUJD');
});

test('anthropic: transkrip -> struktur valid; semua tool_result dalam SATU pesan user, di AWAL, sebelum teks/gambar', () => {
  const m = anthropicAdapter.toAnthropicMessages(TRANSCRIPT);
  const asstIdx = m.findIndex((x) => x.role === 'assistant' && x.content.some((b) => b.type === 'tool_use'));
  assert.deepEqual(m[asstIdx].content.filter((b) => b.type === 'tool_use').map((b) => b.id), ['c1', 'c2']);
  const next = m[asstIdx + 1];
  assert.equal(next.role, 'user');
  assert.deepEqual(next.content.slice(0, 2).map((b) => [b.type, b.tool_use_id]), [['tool_result', 'c1'], ['tool_result', 'c2']]);
  assert.deepEqual(next.content.slice(2).map((b) => b.type), ['text', 'image']);
  assert.equal(next.content[3].source.type, 'base64');
  assert.deepEqual(m.map((x) => x.role), ['user', 'assistant', 'user', 'assistant', 'user']);
  assert.deepEqual(m[2].content.map((b) => b.type), ['text', 'text']);
  for (const x of m) for (const b of x.content) if (b.type === 'text') assert.ok(b.text.length > 0);
});

test('anthropic: hasil tool yatim dibuang; assistant kosong diberi teks pengganti', () => {
  const m = anthropicAdapter.toAnthropicMessages([
    { role: 'user', text: 'a' }, { role: 'tool', toolCallId: 'x', name: 't', text: 'yatim' }, { role: 'assistant', text: '' }, { role: 'user', text: 'b' },
  ]);
  assert.equal(JSON.stringify(m).includes('yatim'), false);
  assert.equal(m[1].content[0].text, '(tidak ada jawaban)');
});

test('gemini: transkrip -> functionCall/functionResponse berpasangan', () => {
  const c = geminiAdapter.toGeminiContents(TRANSCRIPT);
  const calls = c.flatMap((x) => x.parts).filter((p) => p.functionCall).length;
  const resps = c.flatMap((x) => x.parts).filter((p) => p.functionResponse).length;
  assert.equal(calls, 2);
  assert.equal(resps, 2);
  for (let i = 1; i < c.length; i += 1) assert.notEqual(c[i].role, c[i - 1].role);
});

test('anthropic.call: parameter, thinking dipertahankan utuh, usage dinormalisasi, truncated', async () => {
  const seen = [];
  const content = [
    { type: 'thinking', thinking: 'mikir', signature: 'sig-1' },
    { type: 'text', text: 'membaca' },
    { type: 'tool_use', id: 'tu1', name: 'project_read_file', input: { path: 'a.js' } },
  ];
  clients.setFactoriesForTest({ anthropic: () => ({ messages: { create: async (body, opts) => {
    seen.push({ body, opts });
    return { content, stop_reason: 'tool_use', usage: { input_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 3, output_tokens: 7 } };
  } } }) });
  const a = anthropicAdapter.create(cfg());
  const ac = new AbortController();
  const out = await a.call({ system: 'SYS', messages: TRANSCRIPT, tools: [TOOL], model: 'claude-sonnet-5-5', maxTokens: 0, signal: ac.signal });
  const { body, opts } = seen[0];
  assert.equal(body.max_tokens, 8000, 'max_tokens tidak pernah 0/kosong');
  assert.equal(body.system, 'SYS');
  assert.ok(!body.messages.some((m) => m.role === 'system'));
  assert.deepEqual(body.tools[0].input_schema, TOOL.parameters);
  assert.equal(body.tool_choice, undefined);
  assert.equal(body.thinking, undefined, 'thinking dibiarkan default (adaptive)');
  for (const k of ['temperature', 'top_p', 'top_k']) assert.equal(body[k], undefined);
  assert.equal(opts.signal, ac.signal);
  assert.deepEqual(out.usage, { prompt: 18, completion: 7, cached: 5 });
  assert.equal(out.truncated, false);
  assert.equal(out.toolCalls[0].id, 'tu1');
  assert.deepEqual(out.toolCalls[0].args, { path: 'a.js' });
  assert.equal(out.rawAnthropic, content, 'blok thinking disimpan utuh untuk replay');

  const replay = anthropicAdapter.toAnthropicMessages([{ role: 'user', text: 'x' },
    { role: 'assistant', text: 'membaca', toolCalls: out.toolCalls, rawAnthropic: out.rawAnthropic },
    { role: 'tool', toolCallId: 'tu1', name: 'project_read_file', text: 'ok' }]);
  assert.equal(replay[1].content, content);
  assert.equal(replay[2].content[0].type, 'tool_result');

  assert.equal((await a.call({ system: 's', messages: [], model: 'm', maxTokens: 999999 }), seen[1].body.max_tokens), 21333);
});

test('anthropic.call: tool_choice none mempertahankan daftar tools; stop_reason max_tokens -> truncated + argsError', async () => {
  const bodies = [];
  clients.setFactoriesForTest({ anthropic: () => ({ messages: { create: async (body) => {
    bodies.push(body);
    return { content: [{ type: 'tool_use', id: 't', name: 'project_read_file', input: {} }], stop_reason: 'max_tokens', usage: { input_tokens: 1, output_tokens: 2 } };
  } } }) });
  const out = await anthropicAdapter.create(cfg()).call({ system: 's', messages: [{ role: 'user', text: 'x' }], tools: [TOOL], model: 'm', maxTokens: 100, toolChoice: 'none' });
  assert.deepEqual(bodies[0].tool_choice, { type: 'none' });
  assert.equal(bodies[0].tools.length, 1);
  assert.equal(out.truncated, true);
  assert.ok(out.toolCalls[0].argsError);
});

test('openai.call: nama parameter token per provider, tools, thinking DeepSeek, usage, truncated, argsError', async () => {
  const bodies = [];
  let reply;
  clients.setFactoriesForTest({ openai: () => ({ chat: { completions: { create: async (body, opts) => { bodies.push({ body, opts }); return reply; } } } }) });
  reply = { choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [
    { id: 'a', function: { name: 'project_read_file', arguments: '{"path":"a"}' } },
    { id: 'b', function: { name: 'project_read_file', arguments: '{rusak' } },
  ] } }], usage: { prompt_tokens: 20, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 12 } } };

  const oa = openaiAdapter.create(cfg({ tokenParam: 'max_completion_tokens' }));
  const out = await oa.call({ system: 's', messages: [{ role: 'user', text: 'x' }], tools: [TOOL], model: 'gpt-5.5', maxTokens: 500 });
  assert.equal(bodies[0].body.max_completion_tokens, 500);
  assert.equal(bodies[0].body.max_tokens, undefined);
  assert.equal(bodies[0].body.tool_choice, 'auto');
  assert.deepEqual(out.usage, { prompt: 20, completion: 4, cached: 12 });
  assert.deepEqual(out.toolCalls[0].args, { path: 'a' });
  assert.ok(out.toolCalls[1].argsError);

  const ds = openaiAdapter.create(cfg({ extraBody: { thinking: { type: 'disabled' } } }));
  await ds.call({ system: 's', messages: [{ role: 'user', text: 'x' }], model: 'deepseek-flash', maxTokens: 50 });
  assert.deepEqual(bodies[1].body.thinking, { type: 'disabled' });
  assert.equal(bodies[1].body.max_tokens, 50);

  reply = { choices: [{ finish_reason: 'length', message: { content: 'potong', tool_calls: [{ id: 'z', function: { name: 'project_read_file', arguments: '{"pa' } }] } }] };
  const cut = await oa.call({ system: 's', messages: [], tools: [TOOL], model: 'm', maxTokens: 5, toolChoice: 'none' });
  assert.equal(bodies[2].body.tools, undefined, 'toolChoice none -> tools tidak dikirim');
  assert.equal(cut.truncated, true);
  assert.match(cut.toolCalls[0].argsError, /terpotong/);
});

test('capabilities.images=false: gambar diganti teks penanda di adapter openai dan anthropic', async () => {
  const sent = {};
  clients.setFactoriesForTest({
    openai: () => ({ chat: { completions: { create: async (b) => { sent.openai = b; return { choices: [{ message: { content: 'ok' } }] }; } } } }),
    anthropic: () => ({ messages: { create: async (b) => { sent.anthropic = b; return { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: {} }; } } }),
  });
  const msgs = [{ role: 'user', text: 'lihat', images: [IMG, IMG] }];
  await openaiAdapter.create(cfg({ capabilities: { images: false, tools: true } })).call({ system: 's', messages: msgs, model: 'm', maxTokens: 10 });
  await anthropicAdapter.create(cfg({ capabilities: { images: false, tools: true } })).call({ system: 's', messages: msgs, model: 'm', maxTokens: 10 });
  for (const body of [JSON.stringify(sent.openai), JSON.stringify(sent.anthropic)]) {
    assert.ok(!body.includes('QUJD') && !body.includes('image_url') && !body.includes('"type":"image"'));
    assert.match(body, /2 gambar tidak dikirim/);
  }
  assert.equal(stripImages([{ role: 'user', text: 'a' }])[0].text, 'a');
});

test('klien SDK dibuat dengan maxRetries = 0 (retry hanya milik VIA)', () => {
  clients.setFactoriesForTest();
  const seen = {};
  const orig = Module._load;
  const cap = (k) => class { constructor(o) { seen[k] = o; } };
  Module._load = function (req, ...rest) {
    if (req === 'openai') return cap('openai');
    if (req === '@anthropic-ai/sdk') return cap('anthropic');
    return orig.call(this, req, ...rest);
  };
  try {
    clients.getClient('openai', { apiKey: 'a1234567', baseURL: 'https://x.example/v1', cacheId: 'r1' });
    clients.getClient('anthropic', { apiKey: 'b1234567', baseURL: 'https://api.anthropic.com', cacheId: 'r2' });
  } finally { Module._load = orig; clients.clearCache(); }
  assert.equal(seen.openai.maxRetries, 0);
  assert.equal(seen.anthropic.maxRetries, 0);
  assert.equal(seen.openai.baseURL, 'https://x.example/v1');
});

test('classifyCommon: jenis error', () => {
  const e = (o) => Object.assign(new Error(o.message || 'x'), o);
  assert.equal(classifyCommon(e({ status: 401 })).kind, 'auth');
  assert.equal(classifyCommon(e({ status: 404, message: 'model: foo not found' })).kind, 'model');
  assert.equal(classifyCommon(e({ status: 429, headers: { 'retry-after': '3' } })).kind, 'rate_limit');
  assert.equal(classifyCommon(e({ status: 529 })).kind, 'overloaded');
  assert.equal(classifyCommon(e({ status: 400, message: 'prompt is too long: 300000 tokens' })).kind, 'context');
  assert.equal(classifyCommon(e({ message: 'Connection error.', name: 'APIConnectionError' })).kind, 'network');
  assert.equal(classifyCommon(e({ status: 500 })).kind, 'other');
  assert.equal(classifyCommon(e({ status: 429, headers: { 'retry-after': '3' } })).waitMs > 0, true);
});

test('redact: nilai kunci dan pola umum disembunyikan', () => {
  const s = redact('gagal sk-ant-abcdefghijklmnop dan Bearer abcdefgh12345678 dan rahasia-khusus-1', ['rahasia-khusus-1']);
  assert.ok(!/sk-ant|abcdefgh12345678|rahasia-khusus-1/.test(s));
});
