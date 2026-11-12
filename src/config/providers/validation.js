const RESERVED_IDS = ['claude', 'openai', 'deepseek', 'gemini', 'anoman'];
const ID_RE = /^[a-z0-9-]{2,32}$/;
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,99}$/;
const PROTOCOLS = ['openai', 'anthropic'];
const { PHASES } = require('../../shared/phases');
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

function isLocalHostname(hostname) {
  return LOCAL_HOSTS.includes(String(hostname || '').toLowerCase());
}

function validateBaseURL(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'Base URL harus berupa teks' };
  const s = raw.trim();
  if (!s || s.length > 300 || /[\u0000-\u001f\u007f\s]/.test(s)) return { ok: false, error: 'Base URL tidak valid' };
  let u;
  try { u = new URL(s); } catch { return { ok: false, error: 'Base URL tidak valid' }; }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLocalHostname(u.hostname))) {
    return { ok: false, error: 'Base URL wajib https (http hanya untuk localhost, 127.0.0.1, atau [::1])' };
  }
  if (u.username || u.password) return { ok: false, error: 'Base URL tidak boleh memuat nama pengguna atau kata sandi' };
  if (u.search || u.hash) return { ok: false, error: 'Base URL tidak boleh memuat query atau fragmen' };
  const url = `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  return { ok: true, url, host: u.host, local: isLocalHostname(u.hostname) };
}

function validateModelName(name) {
  return typeof name === 'string' && MODEL_RE.test(name.trim());
}

function validateModels(models, { partial = false } = {}) {
  if (!models || typeof models !== 'object') return { ok: false, error: 'Model harus berupa objek' };
  const out = {};
  for (const phase of PHASES) {
    const v = models[phase];
    if (v === undefined && partial) continue;
    if (!validateModelName(v)) return { ok: false, error: `Nama model fase "${phase}" tidak valid` };
    out[phase] = v.trim();
  }
  return { ok: true, models: out };
}

function validateDef(def, { existingIds = [] } = {}) {
  if (!def || typeof def !== 'object') return { ok: false, error: 'Definisi provider tidak valid' };
  const id = typeof def.id === 'string' ? def.id.trim() : '';
  if (!ID_RE.test(id)) return { ok: false, error: 'Id provider harus 2-32 karakter: huruf kecil, angka, atau tanda hubung' };
  if (RESERVED_IDS.includes(id)) return { ok: false, error: `Id "${id}" dipakai provider bawaan` };
  if (existingIds.includes(id)) return { ok: false, error: `Id "${id}" sudah dipakai` };
  const label = typeof def.label === 'string' ? def.label.trim() : '';
  if (!label || label.length > 40 || /[\u0000-\u001f\u007f<>]/.test(label)) return { ok: false, error: 'Nama provider wajib diisi (maks. 40 karakter)' };
  if (!PROTOCOLS.includes(def.protocol)) return { ok: false, error: 'Protokol harus "openai" atau "anthropic"' };
  const url = validateBaseURL(def.baseURL);
  if (!url.ok) return url;
  const models = validateModels(def.models);
  if (!models.ok) return models;
  const caps = def.capabilities || {};
  return {
    ok: true,
    def: {
      id, label, protocol: def.protocol, baseURL: url.url, models: models.models,
      capabilities: { images: caps.images === true, tools: caps.tools !== false },
    },
  };
}

module.exports = { RESERVED_IDS, PHASES, isLocalHostname, validateBaseURL, validateModelName, validateModels, validateDef };
