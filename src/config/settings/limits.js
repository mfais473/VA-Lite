const envStore = require('../env-store');
const outputLimit = require('../../ai/output-limit');
const { fail, safeMessage } = require('./validation');

function getLimits() {
  const general = outputLimit.parseLimit(process.env.VIA_MAX_OUTPUT_TOKENS);
  const coding = String(process.env.VIA_MAX_OUTPUT_TOKENS_CODING || '').trim();
  const codingParsed = outputLimit.parseLimit(coding);
  return {
    ok: true,
    limits: {
      mode: general.mode,
      value: general.value,
      min: outputLimit.MIN_CUSTOM,
      max: outputLimit.MAX_CUSTOM,
      codingOverride: coding === '' ? null : outputLimit.describeLimit('coding'),
      coding: codingParsed.mode === 'custom' ? { mode: 'custom', value: codingParsed.value } : { mode: 'inherit', value: null },
    },
  };
}

function saveLimits(data) {
  try {
    const d = data && typeof data === 'object' ? data : {};
    if (d.mode !== 'default' && d.mode !== 'custom') return fail('Mode harus "default" atau "custom"');

    const set = {};
    const remove = [];
    if (d.mode === 'custom') {
      const v = outputLimit.validateCustom(d.value);
      if (!v.ok) return fail(v.error);
      set.VIA_MAX_OUTPUT_TOKENS = String(v.value);
    } else {
      remove.push('VIA_MAX_OUTPUT_TOKENS');
    }

    const c = d.coding && typeof d.coding === 'object' ? d.coding : null;
    if (c && c.mode === 'custom') {
      const v = outputLimit.validateCustom(c.value);
      if (!v.ok) return fail(`Batas khusus coding: ${v.error}`);
      set.VIA_MAX_OUTPUT_TOKENS_CODING = String(v.value);
    } else if (c && c.mode !== 'inherit') {
      return fail('Mode coding harus "inherit" atau "custom"');
    } else {
      remove.push('VIA_MAX_OUTPUT_TOKENS_CODING');
    }
    envStore.apply({ set, remove });
    return getLimits();
  } catch (err) {
    return fail(safeMessage(err));
  }
}

module.exports = { getLimits, saveLimits };
