const { PARAM_KEYS } = require('../settings/params-schema');

const MAX_VALUE_CHARS = 2048;
const SETTING_KEYS = ['VIA_MAX_OUTPUT_TOKENS', 'VIA_MAX_OUTPUT_TOKENS_CODING', ...PARAM_KEYS];

function isAllowedKey(key) {
  if (typeof key !== 'string' || !/^[A-Z][A-Z0-9_]{0,79}$/.test(key)) return false;
  if (key === 'LLM_PROVIDER' || SETTING_KEYS.includes(key)) return true;
  if (key.endsWith('_API_KEY') && key.length > '_API_KEY'.length) return true;
  if (key.endsWith('_BASE_URL') && key.length > '_BASE_URL'.length) return true;
  return /^[A-Z0-9_]*[A-Z0-9]_MODEL_[A-Z0-9_]+$/.test(key);
}

function valueProblem(value) {
  if (typeof value !== 'string') return 'bukan teks';
  if (/[\r\n\u0000]/.test(value)) return 'mengandung karakter baris baru atau NUL';
  if (value.length > MAX_VALUE_CHARS) return 'terlalu panjang';
  return null;
}

module.exports = { isAllowedKey, valueProblem };
