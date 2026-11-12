const { getTool } = require('./registry');

const TOOL_TIMEOUT_MS = 120000;

function normalizeArgs(tool, rawArgs) {
  const params = tool.params || {};
  const input = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
  const args = {};
  for (const [k, spec] of Object.entries(params)) {
    const v = input[k];
    const missing = v === undefined || v === null;
    const blank = !missing && String(v).trim() === '';
    if (missing || (blank && !spec.allowEmpty)) {
      if (spec.required) return { error: `Argumen wajib "${k}" tidak ada` };
      continue;
    }
    const str = typeof v === 'object' ? JSON.stringify(v) : String(v);
    args[k] = spec.raw ? str : str.trim();
  }
  return { args };
}

function describeCall(tool, args) {
  try {
    return tool.describe ? tool.describe(args) : `Boleh aku menjalankan ${tool.name}?`;
  } catch {
    return `Boleh aku menjalankan ${tool.name}?`;
  }
}

async function validateCall(tool, args) {
  if (typeof tool.validate !== 'function') return null;
  try {
    return (await tool.validate(args)) || null;
  } catch (err) {
    return err.message || 'Validasi gagal';
  }
}

function digestOf(tool, args) {
  try {
    return typeof tool.digestOf === 'function' ? tool.digestOf(args) : null;
  } catch {
    return null;
  }
}

async function executeTool(name, args, ctx = {}) {
  const tool = getTool(name);
  if (!tool) return { success: false, error: `Tool "${name}" tidak dikenal` };
  let timer;
  try {
    return await Promise.race([
      tool.execute(args, ctx),
      new Promise((_, rej) => {
        timer = setTimeout(() => rej(new Error('Tool melebihi batas waktu')), tool.timeoutMs || TOOL_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { normalizeArgs, describeCall, validateCall, digestOf, executeTool };
