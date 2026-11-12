'use strict';

const store = require('../../config/providers-store');
const { PRESETS } = require('./presets');

const { PHASES } = require('../../shared/phases');

const ADAPTERS = {
  openai: () => require('./openai'),
  anthropic: () => require('./anthropic'),
  gemini: () => require('./gemini'),
};

const env = (name) => (name && process.env[name] ? String(process.env[name]).trim() : '');

function getDef(id) {
  const key = String(id || '').toLowerCase();
  if (PRESETS[key]) return { ...PRESETS[key], builtin: true, custom: false };
  const c = store.get(key);
  if (!c) return null;
  return { ...c, builtin: false, custom: true, keyEnv: store.keyEnvFor(c.id), tokenParam: 'max_tokens' };
}

function listDefs() {
  return [...Object.keys(PRESETS).map((id) => getDef(id)), ...store.list().map((c) => getDef(c.id))];
}

function resolveModels(def) {
  if (def.custom) return { ...def.models };
  const e = (phase) => env(def.modelEnv[phase]);
  return {
    primary: e('primary') || def.defaults.primary,
    followUp: e('followUp') || def.defaults.followUp,
    coding: e('coding') || e('followUp') || def.defaults.coding,
  };
}

function resolveBaseURL(def) {
  if (def.custom) return def.baseURL;
  return (def.baseUrlEnv && env(def.baseUrlEnv)) || def.baseURL;
}

function hostOf(def, baseURL) {
  if (def.host) return def.host;
  try { return new URL(baseURL).host; } catch { return ''; }
}

function activeId() {
  return (process.env.LLM_PROVIDER || 'gemini').trim().toLowerCase();
}

function resolve(id = activeId()) {
  const def = getDef(id);
  if (!def) {
    throw new Error(`Provider aktif "${id}" tidak dikenal. Buka Pengaturan (ikon gir) untuk memilih provider.`);
  }
  const baseURL = resolveBaseURL(def);
  let apiKey = env(def.keyEnv);
  if (!apiKey && def.custom) {
    const check = store.validateBaseURL(baseURL);
    if (check.ok && check.local) apiKey = 'tidak-perlu';
  }
  return {
    id: def.id, label: def.label, protocol: def.protocol, builtin: def.builtin, custom: def.custom,
    baseURL, host: hostOf(def, baseURL), apiKey, hasKey: Boolean(apiKey), keyEnv: def.keyEnv,
    models: resolveModels(def), capabilities: { ...def.capabilities },
    tokenParam: def.tokenParam || 'max_tokens', extraBody: def.extraBody,
  };
}

function resolveForCall(id) {
  const cfg = resolve(id);
  if (!cfg.hasKey) {
    throw new Error(`Kunci API untuk provider "${cfg.label}" belum diisi. Buka Pengaturan (ikon gir) di Via untuk mengisinya.`);
  }
  return cfg;
}

function createAdapter(cfg) {
  const load = ADAPTERS[cfg.protocol];
  if (!load) throw new Error(`Protokol provider tidak dikenal: ${cfg.protocol}`);
  return load().create(cfg);
}

function publicSummary(id) {
  const def = getDef(id);
  if (!def) return null;
  const cfg = resolve(id);
  return {
    id: def.id, label: def.label, protocol: def.protocol, builtin: def.builtin, custom: def.custom,
    baseURL: cfg.baseURL || '', host: cfg.host, editableBaseURL: Boolean(def.custom || def.baseUrlEnv),
    defaultBaseURL: def.custom ? '' : (def.baseURL || ''),
    models: cfg.models, defaultModels: def.custom ? {} : { ...def.defaults },
    capabilities: cfg.capabilities, hasKey: cfg.hasKey && cfg.apiKey !== 'tidak-perlu',
  };
}

module.exports = {
  PRESETS, PHASES, getDef, listDefs, activeId, resolve, resolveForCall, createAdapter, publicSummary,
};
