'use strict';

const envStore = require('./env-store');
const store = require('./providers-store');
const registry = require('../ai/providers');
const { fail, safeMessage, validateApiKey, guardActive } = require('./settings/validation');
const { getLimits, saveLimits } = require('./settings/limits');
const { getParams, saveParams } = require('./settings/params');
const { test } = require('./settings/connection-test');

const { PHASES } = require('../shared/phases');

function getState() {
  return {
    active: registry.activeId(),
    providers: registry.listDefs().map((d) => registry.publicSummary(d.id)),
  };
}

function save(providerId, data, ctx) {
  try {
    const def = registry.getDef(providerId);
    if (!def) return fail('Provider tidak ditemukan');
    const blocked = guardActive(def.id, ctx);
    if (blocked) return fail(blocked, { busy: true });
    const d = data && typeof data === 'object' ? data : {};

    const set = {};
    const remove = [];
    let customPatch = null;

    if (typeof d.apiKey === 'string' && d.apiKey.trim() !== '') {
      const problem = validateApiKey(d.apiKey);
      if (problem) return fail(problem);
      set[def.keyEnv] = d.apiKey.trim();
    }

    if (d.baseURL !== undefined) {
      const raw = typeof d.baseURL === 'string' ? d.baseURL.trim() : '';
      if (def.custom) {
        const u = store.validateBaseURL(raw);
        if (!u.ok) return fail(u.error);
        customPatch = { ...(customPatch || {}), baseURL: u.url };
      } else if (!def.baseUrlEnv) {
        if (raw) return fail(`Provider ${def.label} tidak mendukung perubahan base URL`);
      } else if (raw === '') {
        remove.push(def.baseUrlEnv);
      } else {
        const u = store.validateBaseURL(raw);
        if (!u.ok) return fail(u.error);
        set[def.baseUrlEnv] = u.url;
      }
    }

    if (d.models !== undefined) {
      if (!d.models || typeof d.models !== 'object') return fail('Model harus berupa objek');
      const patch = {};
      for (const phase of PHASES) {
        const v = d.models[phase];
        if (v === undefined) continue;
        const name = typeof v === 'string' ? v.trim() : '';
        if (def.custom) {
          if (!store.validateModelName(name)) return fail(`Nama model fase "${phase}" tidak valid`);
          patch[phase] = name;
        } else if (name === '') {
          remove.push(def.modelEnv[phase]);
        } else {
          if (!store.validateModelName(name)) return fail(`Nama model fase "${phase}" tidak valid`);
          set[def.modelEnv[phase]] = name;
        }
      }
      if (def.custom && Object.keys(patch).length) customPatch = { ...(customPatch || {}), models: patch };
    }

    if (Object.keys(set).length || remove.length) envStore.apply({ set, remove });
    if (customPatch) store.update(def.id, customPatch);
    return { ok: true, state: getState() };
  } catch (err) {
    return fail(safeMessage(err));
  }
}

function setActive(providerId, ctx) {
  try {
    if (ctx && ((ctx.isBusy && ctx.isBusy()) || (ctx.hasPending && ctx.hasPending()))) {
      return fail('Tidak bisa ganti provider saat Via sedang bekerja atau menunggu izin.', { busy: true });
    }
    const def = registry.getDef(providerId);
    if (!def) return fail('Provider tidak ditemukan');
    envStore.apply({ set: { LLM_PROVIDER: def.id } });
    const cfg = registry.resolve(def.id);
    return { ok: true, warning: cfg.hasKey ? undefined : 'Kunci API provider ini belum diisi.', state: getState() };
  } catch (err) {
    return fail(safeMessage(err));
  }
}

function addCustom(def) {
  try {
    const d = def && typeof def === 'object' ? def : {};
    const existing = registry.listDefs().map((x) => x.id);
    const r = store.validateDef(d, { existingIds: existing });
    if (!r.ok) return fail(r.error);
    const key = typeof d.apiKey === 'string' ? d.apiKey.trim() : '';
    if (key) {
      const problem = validateApiKey(key);
      if (problem) return fail(problem);
    } else if (!store.validateBaseURL(r.def.baseURL).local) {
      return fail('Kunci API wajib diisi (boleh kosong hanya untuk server lokal)');
    }
    if (key) envStore.apply({ set: { [store.keyEnvFor(r.def.id)]: key } });
    store.add(r.def);
    return { ok: true, state: getState() };
  } catch (err) {
    return fail(safeMessage(err));
  }
}

function removeCustom(id, ctx) {
  try {
    const def = registry.getDef(id);
    if (!def || !def.custom) return fail('Hanya provider kustom yang bisa dihapus');
    const blocked = guardActive(def.id, ctx);
    if (blocked) return fail(blocked, { busy: true });
    const wasActive = registry.activeId() === def.id;
    store.remove(def.id);
    envStore.apply({ set: wasActive ? { LLM_PROVIDER: 'gemini' } : {}, remove: [def.keyEnv] });
    return { ok: true, switchedTo: wasActive ? 'gemini' : undefined, state: getState() };
  } catch (err) {
    return fail(safeMessage(err));
  }
}

module.exports = {
  getState, save, setActive, addCustom, removeCustom, test, validateApiKey, getLimits, saveLimits, getParams, saveParams,
};
