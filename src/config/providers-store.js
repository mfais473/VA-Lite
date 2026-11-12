'use strict';

const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const {
  RESERVED_IDS, PHASES, isLocalHostname, validateBaseURL, validateModelName, validateModels, validateDef,
} = require('./providers/validation');

let cache = null;

function readFileSafe() {
  try {
    return JSON.parse(fs.readFileSync(paths.providersPath(), 'utf8'));
  } catch (err) {
    if (err && err.code !== 'ENOENT') console.warn('[providers-store] providers.json tidak terbaca, diabaikan');
    return null;
  }
}

function list() {
  if (cache) return cache.map((d) => ({ ...d, models: { ...d.models }, capabilities: { ...d.capabilities } }));
  const raw = readFileSafe();
  const items = raw && Array.isArray(raw.providers) ? raw.providers : [];
  const out = [];
  for (const item of items) {
    const r = validateDef(item, { existingIds: out.map((d) => d.id) });
    if (r.ok) out.push(r.def);
    else console.warn(`[providers-store] entri provider dilewati: ${r.error}`);
  }
  cache = out;
  return list();
}

function save(items) {
  const file = paths.providersPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, providers: items }, null, 2), { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(tmp, 0o600); } catch {}
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch {}
    throw err;
  }
  cache = items.map((d) => ({ ...d }));
}

function get(id) {
  return list().find((d) => d.id === id) || null;
}

function add(def) {
  const current = list();
  const r = validateDef(def, { existingIds: current.map((d) => d.id) });
  if (!r.ok) throw new Error(r.error);
  save([...current, r.def]);
  return r.def;
}

function update(id, patch) {
  const current = list();
  const idx = current.findIndex((d) => d.id === id);
  if (idx === -1) throw new Error('Provider kustom tidak ditemukan');
  const next = { ...current[idx] };
  if (patch && patch.baseURL !== undefined) {
    const u = validateBaseURL(patch.baseURL);
    if (!u.ok) throw new Error(u.error);
    next.baseURL = u.url;
  }
  if (patch && patch.models !== undefined) {
    const m = validateModels(patch.models, { partial: true });
    if (!m.ok) throw new Error(m.error);
    next.models = { ...next.models, ...m.models };
  }
  current[idx] = next;
  save(current);
  return next;
}

function remove(id) {
  const current = list();
  if (!current.some((d) => d.id === id)) throw new Error('Provider kustom tidak ditemukan');
  save(current.filter((d) => d.id !== id));
}

function invalidate() {
  cache = null;
}

function keyEnvFor(id) {
  return `VIA_PROVIDER_${String(id).toUpperCase().replace(/-/g, '_')}_API_KEY`;
}

module.exports = {
  RESERVED_IDS, PHASES, validateBaseURL, validateModelName, validateModels, validateDef,
  list, get, add, update, remove, invalidate, keyEnvFor, isLocalHostname,
};
