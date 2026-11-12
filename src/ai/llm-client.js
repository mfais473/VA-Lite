require('../config/env-store').load();
const registry = require('./providers');
const { getDefaultRetry } = require('./rate-limit-retry');
const { logUsage } = require('./usage-log');
const { classifyCommon, userFacingError, TRUNCATED_ARGS_ERROR } = require('./providers/common');
const { toOpenAIMessages } = require('./providers/openai');
const { toGeminiContents, toGeminiDeclaration } = require('./providers/gemini');

const outputLimit = require('./output-limit');
const maxOutputTokens = (phase) => outputLimit.maxOutputTokens(phase);

const TRUNCATED_TEXT_NOTE = '\n\n(Jawabanku terpotong karena melewati batas panjang keluaran. Minta aku melanjutkan bila perlu.)';

let lastAnnounced = '';
function announce(cfg) {
  const limits = `umum=${outputLimit.describeLimit('primary')}, coding=${outputLimit.describeLimit('coding')}`;
  const sig = `${cfg.id}|${cfg.models.primary}|${cfg.models.followUp}|${cfg.models.coding}|${limits}`;
  if (sig === lastAnnounced) return;
  lastAnnounced = sig;
  console.log(
    `[llm-client] provider=${cfg.id} primary=${cfg.models.primary} followUp=${cfg.models.followUp} coding=${cfg.models.coding}\n` +
    `[llm-client] batas keluaran: ${limits}`
  );
}

async function callLLM({ system, messages, tools = [], stableTools, phase = 'primary', signal }) {
  const cfg = registry.resolveForCall();
  const adapter = registry.createAdapter(cfg);
  const model = cfg.models[phase] || cfg.models.primary;
  announce(cfg);

  const useStable = cfg.protocol === 'anthropic' && Array.isArray(stableTools) && stableTools.length > 0;
  const sendTools = useStable ? stableTools : tools;
  const toolChoice = useStable && tools.length === 0 ? 'none' : undefined;
  const maxTokens = maxOutputTokens(phase);

  let out;
  try {
    out = await getDefaultRetry().run(() =>
      adapter.call({ system, messages, tools: sendTools, model, maxTokens, signal, toolChoice })
    );
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    const kind = (err && err.kind) || adapter.classifyError(err).kind;
    const clean = (err && err.kind && !err.status && !err.headers) ? err : userFacingError(err, kind, [cfg.apiKey]);
    console.error(`[llm-client] panggilan gagal (provider=${cfg.id}, jenis=${kind}): ${clean.message}`);
    throw clean;
  }

  const u = out.usage || {};
  logUsage({ model, phase, prompt: u.prompt, completion: u.completion, cached: u.cached, maxTokens, rate: out.rate });
  if (out.truncated) console.warn('[llm-client] keluaran model terpotong (batas panjang jawaban tercapai)');

  const result = { text: out.text, toolCalls: out.toolCalls, truncated: out.truncated };
  if (out.rawGemini) result.rawGemini = out.rawGemini;
  if (out.rawAnthropic) result.rawAnthropic = out.rawAnthropic;
  if (useStable) result.usedStableTools = true;
  return result;
}

function subscribeRateLimit(cb) {
  return getDefaultRetry().subscribe(cb);
}

module.exports = {
  callLLM, subscribeRateLimit, TRUNCATED_TEXT_NOTE, describeOutputLimit: (phase) => outputLimit.describeLimit(phase),
  __test: { toOpenAIMessages, toGeminiContents, toGeminiDeclaration, maxOutputTokens, TRUNCATED_ARGS_ERROR, classifyCommon },
};
