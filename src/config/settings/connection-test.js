const registry = require('../../ai/providers');
const { safeMessage } = require('./validation');

const PROBE_TOOL = {
  name: 'ping_tool',
  description: 'Tool uji koneksi. Panggil dengan value "ok".',
  parameters: { type: 'object', properties: { value: { type: 'string', description: 'Selalu "ok"' } }, required: ['value'] },
};

const TEST_TIMEOUT_MS = 30000;

async function test(providerId) {
  let cfg;
  try {
    cfg = registry.resolve(providerId);
  } catch (err) {
    return { ok: false, latencyMs: 0, errorKind: 'other', toolsOk: null, message: safeMessage(err) };
  }
  if (!cfg.hasKey) return { ok: false, latencyMs: 0, errorKind: 'auth', toolsOk: null, message: 'Kunci API belum diisi.' };

  const adapter = registry.createAdapter(cfg);
  const model = cfg.models.primary;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TEST_TIMEOUT_MS);
  const started = Date.now();
  try {
    await adapter.call({
      system: 'Ini uji koneksi. Jawab singkat.',
      messages: [{ role: 'user', text: 'Balas satu kata: ok' }],
      model, maxTokens: 64, signal: ac.signal,
    });
    const latencyMs = Date.now() - started;
    let toolsOk = null;
    if (cfg.capabilities.tools) {
      try {
        const r = await adapter.call({
          system: 'Ini uji tool-call. Panggil tool yang tersedia.',
          messages: [{ role: 'user', text: 'Panggil tool ping_tool dengan value "ok".' }],
          tools: [PROBE_TOOL], model, maxTokens: 512, signal: ac.signal,
        });
        toolsOk = r.toolCalls.some((c) => c.name === PROBE_TOOL.name && !c.argsError);
      } catch {
        toolsOk = false;
      }
    }
    return { ok: true, latencyMs, toolsOk };
  } catch (err) {
    const kind = ac.signal.aborted ? 'network' : adapter.classifyError(err).kind;
    return {
      ok: false, latencyMs: Date.now() - started, errorKind: kind, toolsOk: null,
      message: ac.signal.aborted ? 'Waktu uji habis (30 detik).' : safeMessage(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { test };
