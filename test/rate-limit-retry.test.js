const test = require('node:test');
const assert = require('node:assert/strict');
const { createRateLimitRetry, classifyRateLimit, parseDuration } = require('../src/ai/rate-limit-retry');

function err(message, extra = {}) {
  return Object.assign(new Error(message), extra);
}

test('parseDuration memahami format header penyedia', () => {
  assert.equal(parseDuration('6m0s'), 360000);
  assert.equal(parseDuration('1.5s'), 1500);
  assert.equal(parseDuration('20ms'), 20);
  assert.equal(parseDuration('30'), 30000);
  assert.equal(parseDuration(''), undefined);
});

test('Gemini 429 dengan retryDelay: tunggu sebesar petunjuk + 1 detik pengaman', () => {
  const e = err('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","details":[{"retryDelay":"34s"}]}}', { status: 429 });
  const r = classifyRateLimit(e);
  assert.equal(r.retryable, true);
  assert.equal(r.waitMs, 35000);
});

test('Gemini 429 per menit dengan kalimat umum "exceeded your current quota" tetap di-retry', () => {
  const e = err('You exceeded your current quota. Quota exceeded for metric ... GenerateRequestsPerMinutePerProjectPerModel-FreeTier. Please retry in 12.3s.', { status: 429 });
  const r = classifyRateLimit(e);
  assert.equal(r.retryable, true);
  assert.equal(r.waitMs, 13300);
});

test('header retry-after-ms, retry-after (detik) dan x-ratelimit-reset dipakai berurutan', () => {
  assert.equal(classifyRateLimit(err('x', { status: 429, headers: { 'retry-after-ms': '2500' } })).waitMs, 3500);
  assert.equal(classifyRateLimit(err('x', { status: 429, headers: { 'Retry-After': '7' } })).waitMs, 8000);
  const h = new Map([['x-ratelimit-reset-requests', '1s'], ['x-ratelimit-reset-tokens', '20s']]);
  assert.equal(classifyRateLimit(err('x', { status: 429, headers: { get: (k) => h.get(k) ?? null } })).waitMs, 21000);
});

test('tanpa petunjuk: tunggu satu jendela menit (60 detik) + pengaman', () => {
  const r = classifyRateLimit(err('Too many requests', { status: 429 }));
  assert.equal(r.waitMs, 61000);
});

test('kuota harian / saldo habis / petunjuk terlalu lama tidak di-retry', () => {
  assert.equal(classifyRateLimit(err('Quota exceeded ... GenerateRequestsPerDayPerProjectPerModel-FreeTier', { status: 429 })).retryable, false);
  assert.equal(classifyRateLimit(err('You exceeded your quota', { status: 429, code: 'insufficient_quota' })).retryable, false);
  assert.equal(classifyRateLimit(err('x', { status: 429, headers: { 'retry-after': '900' } })).retryable, false);
});

test('error selain limit tidak di-retry', () => {
  assert.equal(classifyRateLimit(err('API key not valid', { status: 400 })).retryable, false);
  assert.equal(classifyRateLimit(err('ECONNRESET')).retryable, false);
});

test('gagal 429 dua kali lalu berhasil: panggilan diulang, tunggu dicatat, status waiting diumumkan lalu dicabut', async () => {
  const sleeps = [];
  const states = [];
  const r = createRateLimitRetry({ sleep: async (ms) => { sleeps.push(ms); }, random: () => 0 });
  r.subscribe((s) => states.push(s));
  let calls = 0;
  const out = await r.run(async () => {
    calls += 1;
    if (calls < 3) throw err('rate limit', { status: 429, headers: { 'retry-after': '10' } });
    return { text: 'ok' };
  });
  assert.deepEqual(out, { text: 'ok' });
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [11000, 11000]);
  assert.deepEqual(states.map((s) => s.waiting), [true, true, false]);
  assert.equal(states[0].attempt, 1);
  assert.equal(states[1].attempt, 2);
});

test('error non-limit dilempar langsung tanpa menunggu atau mengumumkan', async () => {
  const sleeps = [];
  const states = [];
  const r = createRateLimitRetry({ sleep: async (ms) => { sleeps.push(ms); } });
  r.subscribe((s) => states.push(s));
  await assert.rejects(() => r.run(async () => { throw err('API key not valid', { status: 400 }); }), /API key not valid/);
  assert.equal(sleeps.length, 0);
  assert.equal(states.length, 0);
});

test('percobaan habis: error jelas berbahasa Indonesia, error asli tersimpan di cause', async () => {
  const states = [];
  const r = createRateLimitRetry({ maxRetries: 2, sleep: async () => {}, random: () => 0 });
  r.subscribe((s) => states.push(s));
  let calls = 0;
  const original = err('rate limit', { status: 429 });
  await assert.rejects(
    () => r.run(async () => { calls += 1; throw original; }),
    (e) => /masih tercapai setelah 2 kali/.test(e.message) && e.cause === original
  );
  assert.equal(calls, 3);
  assert.equal(states.at(-1).waiting, false);
});

test('kuota harian: tidak menunggu, pesan jelas', async () => {
  const sleeps = [];
  const r = createRateLimitRetry({ sleep: async (ms) => { sleeps.push(ms); } });
  await assert.rejects(
    () => r.run(async () => { throw err('GenerateRequestsPerDayPerProjectPerModel', { status: 429 }); }),
    /kuota harian atau saldo habis/
  );
  assert.equal(sleeps.length, 0);
});

test('subscribe mengembalikan fungsi berhenti', async () => {
  const states = [];
  const r = createRateLimitRetry({ sleep: async () => {}, random: () => 0 });
  const off = r.subscribe((s) => states.push(s));
  off();
  let n = 0;
  await r.run(async () => { if (n++ === 0) throw err('rate limit', { status: 429 }); return 1; });
  assert.equal(states.length, 0);
});
