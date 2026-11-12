require('./helpers/stub-modules');
process.env.VIA_AUTO_TOOLS = '';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const handlers = {};
const opened = [];
const fakeElectron = {
  ipcMain: {
    handle: (channel, fn) => { handlers[channel] = fn; },
    on: (channel, fn) => { handlers[channel] = fn; },
  },
  app: { quit() {} },
  shell: { openExternal: async (url) => { opened.push(url); } },
};
const prevLoad = Module._load;
Module._load = function (request, ...rest) {
  return request === 'electron' ? fakeElectron : prevLoad.call(this, request, ...rest);
};

const llm = require('../src/ai/llm-client');
const memory = require('../src/ai/conversation-memory');
const agent = require('../src/agent/agent-loop');
const { registerIpcHandlers } = require('../src/core/ipc-handlers');
registerIpcHandlers();

const send = (text) => handlers['chat-send']({}, { text });
const choose = (decision) => handlers['confirm-shortcut']({}, { decision });
const call = (name, args, id = name) => ({ toolCalls: [{ id, name, args: { alasan: 'tes', ...args } }] });
const say = (text) => ({ text });

function script(items) {
  const seen = [];
  let i = 0;
  llm.callLLM = async (opts) => {
    seen.push(opts);
    const item = typeof items === 'function' ? items(seen.length - 1) : items[Math.min(i++, items.length - 1)];
    if (item instanceof Error) throw item;
    return { text: '', toolCalls: [], ...item };
  };
  return seen;
}

function reset() {
  agent.cancelPending();
  memory.resetHistory();
  opened.length = 0;
}

test('pesan teks biasa -> balasan teks; giliran masuk memori percakapan', async () => {
  reset();
  script([say('Halo juga!')]);
  const res = await send('  halo via  ');
  assert.deepEqual(res, { text: 'Halo juga!', awaitingConfirmation: false });
  assert.deepEqual(memory.getHistory(), [
    { role: 'user', content: 'halo via' },
    { role: 'assistant', content: 'Halo juga!' },
  ]);
});

test('perintah tool (buka browser) minta izin; tombol Ya menjalankannya lalu Via menjawab', async () => {
  reset();
  script([call('open_browser', { url: 'https://example.com' }), say('Sudah kubuka ya!')]);
  const ask = await send('buka example.com');
  assert.equal(ask.awaitingConfirmation, true);
  assert.match(ask.text, /Boleh aku buka example\.com/);
  assert.match(ask.text, /Klik Ya, Tidak, atau Tanya dulu/);
  assert.deepEqual(opened, [], 'belum boleh jalan sebelum izin');

  const done = await choose('approve');
  assert.deepEqual(done, { text: 'Sudah kubuka ya!', awaitingConfirmation: false });
  assert.deepEqual(opened, ['https://example.com/']);
});

test('izin juga bisa dijawab dengan mengetik: "ya" menyetujui, "tidak" menolak', async () => {
  reset();
  script([call('open_browser', { url: 'https://example.com' }), say('Sudah kubuka ya!')]);
  await send('buka example.com');
  const yes = await send('ya');
  assert.equal(yes.awaitingConfirmation, false);
  assert.equal(opened.length, 1);

  reset();
  script([call('open_browser', { url: 'https://example.org' }), say('Oke, tidak kubuka.')]);
  await send('buka example.org');
  const no = await send('tidak');
  assert.deepEqual(no, { text: 'Oke, tidak kubuka.', awaitingConfirmation: false });
  assert.deepEqual(opened, [], 'ditolak: tool tidak boleh jalan');
});

test('tombol Tidak menolak tanpa menjalankan tool', async () => {
  reset();
  script([call('open_browser', { url: 'https://example.com' }), say('Baik, tidak jadi.')]);
  await send('buka example.com');
  const res = await choose('deny');
  assert.equal(res.text, 'Baik, tidak jadi.');
  assert.deepEqual(opened, []);
});

test('tombol Tanya dulu masuk mode tanya dan tetap menunggu jawaban', async () => {
  reset();
  script([call('open_browser', { url: 'https://example.com' })]);
  await send('buka example.com');
  const res = await choose('ask');
  assert.equal(res.awaitingConfirmation, true);
  assert.match(res.text, /apa yang mau kamu tanyakan/);
  assert.deepEqual(opened, []);
});

test('tombol tanpa izin yang menunggu (atau payload asing) -> noPending', async () => {
  reset();
  assert.deepEqual(await choose('approve'), { noPending: true });
  assert.deepEqual(await handlers['confirm-shortcut']({}, { decision: 'yes' }), { noPending: true });
  assert.deepEqual(await handlers['confirm-shortcut']({}, null), { noPending: true });
});

test('pesan kosong / hanya spasi diabaikan tanpa memanggil model', async () => {
  reset();
  const seen = script([say('tidak boleh dipanggil')]);
  assert.deepEqual(await send(''), { empty: true });
  assert.deepEqual(await send('   \n '), { empty: true });
  assert.deepEqual(await handlers['chat-send']({}, null), { empty: true });
  assert.deepEqual(await handlers['chat-send']({}, { text: 42 }), { empty: true });
  assert.equal(seen.length, 0);
});

test('pesan sangat panjang dipotong di 4000 karakter', async () => {
  reset();
  const seen = script([say('ok')]);
  await send('a'.repeat(9000));
  const userMsg = seen[0].messages.filter((m) => m.role === 'user').pop();
  assert.equal(userMsg.text.length, 4000);
});

test('balasan model kosong -> { empty } (UI menampilkan catatan), tidak masuk memori', async () => {
  reset();
  script([say('   ')]);
  assert.deepEqual(await send('halo'), { empty: true });
  assert.deepEqual(memory.getHistory(), []);
});

test('pesan kedua saat yang pertama masih diproses ditolak dengan { busy }', async () => {
  reset();
  let release;
  const gate = new Promise((r) => { release = r; });
  llm.callLLM = async () => { await gate; return { text: 'selesai', toolCalls: [] }; };
  const first = send('pertama');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(await send('kedua'), { busy: true });
  assert.deepEqual(await choose('approve'), { busy: true });
  release();
  assert.equal((await first).text, 'selesai');
  script([say('lagi')]);
  assert.equal((await send('ketiga')).text, 'lagi');
});

test('galat dari model -> { error }, izin tertunda dibatalkan, dan chat tetap bisa dipakai lagi', async () => {
  reset();
  script([call('open_browser', { url: 'https://example.com' })]);
  await send('buka example.com');
  assert.equal(agent.hasPending(), true);

  script([new Error('kunci API salah')]);
  const res = await send('ya');
  assert.deepEqual(res, { error: 'kunci API salah' });
  assert.equal(agent.hasPending(), false);

  script([say('sudah pulih')]);
  assert.equal((await send('halo')).text, 'sudah pulih');
});

test('IPC jendela: buka/tutup panel mengembalikan sudut gelembung; geser aman tanpa jendela', async () => {
  const p = await handlers['window-set-expanded']({}, true);
  assert.ok(['left', 'right'].includes(p.h) && ['top', 'bottom'].includes(p.v));
  assert.doesNotThrow(() => {
    handlers['window-drag-start']({});
    handlers['window-drag-move']({}, { dx: 'x', dy: NaN });
    handlers['window-drag-move']({}, null);
    handlers['window-drag-end']({}, { moved: true });
  });
});
