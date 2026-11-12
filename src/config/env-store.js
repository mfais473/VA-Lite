'use strict';

const paths = require('./paths');
const { isAllowedKey, valueProblem } = require('./env/allowlist');
const { formatValue, LINE_RE, parse } = require('./env/format');
const { readText, atomicWrite } = require('./env/file-io');

let loaded = false;

function load({ force = false } = {}) {
  if (loaded && !force) return { path: paths.envPath(), count: 0, skipped: true };
  loaded = true;
  const file = paths.envPath();
  let text = '';
  try {
    text = readText(file);
  } catch (err) {
    console.warn(`[env-store] gagal membaca ${file}: ${err.code || 'error'}`);
    return { path: file, count: 0 };
  }
  let count = 0;
  for (const [k, v] of Object.entries(parse(text))) {
    if (process.env[k] === undefined) {
      process.env[k] = v;
      count += 1;
    }
  }
  return { path: file, count };
}

function apply({ set = {}, remove = [] } = {}) {
  const setKeys = Object.keys(set);
  for (const k of [...setKeys, ...remove]) {
    if (!isAllowedKey(k)) throw new Error(`Kunci konfigurasi tidak diizinkan: ${String(k).slice(0, 60)}`);
  }
  for (const k of setKeys) {
    const problem = valueProblem(set[k]);
    if (problem) throw new Error(`Nilai untuk ${k} ditolak: ${problem}`);
  }
  if (!setKeys.length && !remove.length) return { changed: [] };

  const file = paths.envPath();
  const original = readText(file);
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const hadFinalNewline = original === '' || /\r?\n$/.test(original);
  const lines = original === '' ? [] : original.replace(/\r?\n$/, '').split(/\r?\n/);

  const written = new Set();
  const out = [];
  for (const line of lines) {
    const m = /^\s*#/.test(line) ? null : LINE_RE.exec(line);
    const key = m ? m[1] : null;
    if (key && remove.includes(key)) continue;
    if (key && Object.prototype.hasOwnProperty.call(set, key)) {
      if (written.has(key)) continue;
      written.add(key);
      out.push(`${key}=${formatValue(set[key])}`);
      continue;
    }
    out.push(line);
  }
  for (const k of setKeys) if (!written.has(k)) out.push(`${k}=${formatValue(set[k])}`);

  const content = out.join(eol) + (out.length && (hadFinalNewline || setKeys.length) ? eol : '');
  atomicWrite(file, content);

  for (const k of setKeys) process.env[k] = set[k];
  for (const k of remove) delete process.env[k];
  return { changed: [...setKeys, ...remove] };
}

module.exports = { load, apply, parse, isAllowedKey, formatValue, __test: { resetLoaded: () => { loaded = false; } } };
