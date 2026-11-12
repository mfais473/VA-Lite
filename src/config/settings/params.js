'use strict';

const path = require('path');
const envStore = require('../env-store');
const { GROUPS, PARAMS } = require('./params-schema');
const { fail, safeMessage } = require('./validation');

const MAX_DIRS = 20;
const MAX_DIR_CHARS = 500;
const MAX_TOOLS = 30;

const byKey = new Map(PARAMS.map((p) => [p.key, p]));

function toolInfo() {
  try {
    const { TOOLS } = require('../../tools/registry');
    return TOOLS;
  } catch {
    return null;
  }
}

function parseInt10(spec, text) {
  if (!/^\d{1,10}$/.test(text)) return { error: 'harus berupa bilangan bulat tanpa tanda' };
  const n = Number(text);
  if (n < spec.min || n > spec.max) return { error: `harus antara ${spec.min} dan ${spec.max}` };
  return { value: String(n) };
}

function parseStatuses(text) {
  const parts = text.split(/[,\s]+/).filter(Boolean);
  if (!parts.length) return { remove: true };
  const out = [];
  for (const s of parts) {
    if (!/^\d{3}$/.test(s) || Number(s) < 500 || Number(s) > 599) return { error: `"${s.slice(0, 12)}" bukan kode status 500-599` };
    if (!out.includes(s)) out.push(s);
  }
  return { value: out.join(',') };
}

function parseDirs(text) {
  const parts = text.split(/[;\r\n]+/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return { remove: true };
  if (parts.length > MAX_DIRS) return { error: `maksimal ${MAX_DIRS} folder` };
  const out = [];
  for (const d of parts) {
    if (d.length > MAX_DIR_CHARS) return { error: 'ada path yang terlalu panjang' };
    if (/[\u0000-\u001f\u007f]/.test(d)) return { error: 'path mengandung karakter kontrol' };
    if (d.includes(',')) return { error: `path "${d.slice(0, 40)}" mengandung koma; koma dipakai sebagai pemisah oleh Via` };
    if (!path.win32.isAbsolute(d) && !path.posix.isAbsolute(d)) return { error: `"${d.slice(0, 40)}" bukan path lengkap (mis. C:\\Users\\Nama\\Documents)` };
    if (!out.includes(d)) out.push(d);
  }
  return { value: out.join(';') };
}

function parseTools(text) {
  const parts = text.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return { remove: true };
  if (parts.length > MAX_TOOLS) return { error: `maksimal ${MAX_TOOLS} alat` };
  const registry = toolInfo();
  const out = [];
  for (const name of parts) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(name)) return { error: `nama alat "${name.slice(0, 30)}" tidak valid` };
    if (registry) {
      const tool = Object.prototype.hasOwnProperty.call(registry, name) ? registry[name] : null;
      if (!tool) return { error: `alat "${name}" tidak dikenal` };
      if (tool.alwaysConfirm) return { error: `alat "${name}" selalu butuh konfirmasi dan tidak bisa dijalankan otomatis` };
    }
    if (!out.includes(name)) out.push(name);
  }
  return { value: out.join(',') };
}

function parseBool(text) {
  if (text === '') return { remove: true };
  if (text === '1') return { value: '1' };
  if (text === '0') return { remove: true };
  return { error: 'harus berupa pilihan aktif atau mati' };
}

function parseValue(spec, raw) {
  if (typeof raw !== 'string') return { error: 'bukan teks' };
  const text = raw.trim();
  if (text === '' && spec.type !== 'bool') return { remove: true };
  switch (spec.type) {
    case 'int': return parseInt10(spec, text);
    case 'statuses': return parseStatuses(text);
    case 'dirs': return parseDirs(text);
    case 'tools': return parseTools(text);
    case 'bool': return parseBool(text);
    default: return { error: 'jenis pengaturan tidak dikenal' };
  }
}

function view(spec) {
  const raw = process.env[spec.key];
  return {
    key: spec.key,
    type: spec.type,
    label: spec.label,
    hint: spec.hint,
    unit: spec.unit || null,
    min: spec.min === undefined ? null : spec.min,
    max: spec.max === undefined ? null : spec.max,
    default: spec.default,
    defaultLabel: spec.defaultLabel || spec.default,
    restart: Boolean(spec.restart),
    value: typeof raw === 'string' ? raw : '',
  };
}

function getParams() {
  return {
    ok: true,
    groups: GROUPS.map((g) => ({
      id: g.id,
      label: g.label,
      description: g.description,
      params: PARAMS.filter((p) => p.group === g.id).map(view),
    })),
  };
}

function saveParams(data) {
  try {
    const d = data && typeof data === 'object' && !Array.isArray(data) ? data : null;
    const values = d && d.values && typeof d.values === 'object' && !Array.isArray(d.values) ? d.values : null;
    if (!values) return fail('Data pengaturan tidak valid');
    const keys = Object.keys(values);
    if (!keys.length) return fail('Tidak ada yang disimpan');

    const set = {};
    const remove = [];
    for (const key of keys) {
      const spec = byKey.get(key);
      if (!spec) return fail(`Pengaturan tidak dikenal: ${String(key).slice(0, 40)}`);
      const r = parseValue(spec, values[key]);
      if (r.error) return fail(`${spec.label}: ${r.error}`, { key });
      if (r.remove) remove.push(key);
      else set[key] = r.value;
    }
    envStore.apply({ set, remove });
    return getParams();
  } catch (err) {
    return fail(safeMessage(err));
  }
}

module.exports = { getParams, saveParams, __test: { parseValue } };
