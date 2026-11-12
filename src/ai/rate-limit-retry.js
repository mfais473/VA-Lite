'use strict';

const { describeLimitError } = require('./rate-headers');
const { envInt, envStatuses } = require('./rate-limit/env');
const {
  DEFAULT_WAIT_MS, DEFAULT_TRANSIENT_STATUSES, parseDuration, classifyRateLimit, classifyTransient,
} = require('./rate-limit/classify');

function createRateLimitRetry(opts = {}) {
  const maxRetries = opts.maxRetries ?? 3;
  const maxWaitMs = opts.maxWaitMs ?? 120000;
  const defaultWaitMs = opts.defaultWaitMs ?? DEFAULT_WAIT_MS;
  const transientMax = opts.transientMaxRetries ?? 3;
  const transientStatuses = opts.transientStatuses || DEFAULT_TRANSIENT_STATUSES;
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const random = opts.random || Math.random;
  const listeners = new Set();

  function emit(state) {
    for (const cb of listeners) {
      try { cb(state); } catch {}
    }
  }

  function subscribe(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }

  async function run(fn) {
    let attempt = 0;
    let transientAttempt = 0;
    let announced = false;
    try {
      for (;;) {
        try {
          return await fn();
        } catch (err) {
          const info = classifyRateLimit(err, { maxWaitMs, defaultWaitMs });
          if (!info.retryable) {
            if (info.reason && info.reason !== 'bukan error limit') {
              const e = new Error(`Limit pemakaian model tercapai (${info.reason}). Coba lagi nanti.`);
              e.cause = err;
              throw e;
            }
            const tr = transientMax > 0
              ? classifyTransient(err, { attempt: transientAttempt, maxWaitMs, statuses: transientStatuses, random })
              : { retryable: false };
            if (!tr.retryable || transientAttempt >= transientMax) throw err;
            transientAttempt += 1;
            console.warn(`[retry] HTTP ${tr.status} dari penyedia, mengulang dalam ${(tr.waitMs / 1000).toFixed(1)} detik, ` +
              `percobaan ${transientAttempt}/${transientMax} [${describeLimitError(err)}]`);
            await sleep(tr.waitMs);
            continue;
          }
          if (attempt >= maxRetries) {
            const e = new Error(
              `Limit pemakaian model per menit masih tercapai setelah ${maxRetries} kali mencoba ulang. ` +
              'Tunggu sebentar lalu coba lagi.'
            );
            e.cause = err;
            throw e;
          }
          attempt += 1;
          const waitMs = info.waitMs + Math.floor(random() * 1000);
          console.warn(`[rate-limit] 429 dari penyedia, menunggu ${(waitMs / 1000).toFixed(1)} detik ` +
            `(${info.reason}), percobaan ${attempt}/${maxRetries} [${describeLimitError(err)}]`);
          announced = true;
          emit({ waiting: true, waitMs, attempt, maxRetries });
          await sleep(waitMs);
        }
      }
    } finally {
      if (announced) emit({ waiting: false });
    }
  }

  return { run, subscribe };
}

let _default = null;

function getDefaultRetry() {
  if (!_default) {
    _default = createRateLimitRetry({
      maxRetries: envInt('VIA_RATE_RETRY_MAX', 3),
      maxWaitMs: envInt('VIA_RATE_RETRY_MAX_WAIT_MS', 120000),
      defaultWaitMs: envInt('VIA_RATE_RETRY_DEFAULT_WAIT_MS', DEFAULT_WAIT_MS),
      transientMaxRetries: envInt('VIA_TRANSIENT_RETRY_MAX', 3),
      transientStatuses: envStatuses('VIA_TRANSIENT_RETRY_STATUSES', DEFAULT_TRANSIENT_STATUSES),
    });
  }
  return _default;
}

module.exports = { createRateLimitRetry, getDefaultRetry, classifyRateLimit, classifyTransient, parseDuration };
