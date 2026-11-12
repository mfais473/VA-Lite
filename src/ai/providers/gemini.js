'use strict';

const clients = require('./clients');
const { stripImages, classifyCommon } = require('./common');

function toGeminiContents(messages) {
  const contents = [];
  const push = (role, parts) => {
    if (!parts.length) return;
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts.push(...parts);
    else contents.push({ role, parts: [...parts] });
  };

  for (const m of messages) {
    if (m.role === 'user') {
      const parts = [];
      if (m.text) parts.push({ text: m.text });
      for (const img of m.images || []) {
        parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
      }
      push('user', parts);
    } else if (m.role === 'note') {
      if (m.text) push('user', [{ text: m.text }]);
    } else if (m.role === 'assistant') {
      if (m.rawGemini && m.rawGemini.length) {
        push('model', m.rawGemini);
      } else {
        const parts = [];
        if (m.text) parts.push({ text: m.text });
        for (const c of m.toolCalls || []) {
          parts.push({ functionCall: { name: c.name, args: c.args || {} } });
        }
        push('model', parts);
      }
    } else if (m.role === 'tool') {
      push('user', [{ functionResponse: { name: m.name, response: { result: m.text || '' } } }]);
    }
  }
  return contents;
}

function toGeminiDeclaration(t) {
  const props = {};
  for (const [k, v] of Object.entries((t.parameters && t.parameters.properties) || {})) {
    props[k] = { type: String(v.type || 'string').toUpperCase(), description: v.description || '' };
  }
  const decl = { name: t.name, description: t.description };
  if (Object.keys(props).length) {
    decl.parameters = { type: 'OBJECT', properties: props, required: t.parameters.required || [] };
  }
  return decl;
}

function create(cfg) {
  const caps = cfg.capabilities || { images: true, tools: true };

  async function call({ system, messages, tools = [], model, maxTokens, signal, toolChoice }) {
    const client = clients.getClient('gemini', { apiKey: cfg.apiKey, cacheId: cfg.id });
    const config = { systemInstruction: system };
    if (maxTokens) config.maxOutputTokens = maxTokens;
    if (signal) config.abortSignal = signal;
    if (tools.length && toolChoice !== 'none') config.tools = [{ functionDeclarations: tools.map(toGeminiDeclaration) }];

    const response = await client.models.generateContent({
      model,
      contents: toGeminiContents(caps.images ? messages : stripImages(messages)),
      config,
    });

    const cand = response.candidates && response.candidates[0];
    const parts = (cand && cand.content && cand.content.parts) || [];
    const truncated = Boolean(cand) && cand.finishReason === 'MAX_TOKENS';
    const um = response.usageMetadata || {};
    const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('');
    const toolCalls = parts
      .filter((p) => p.functionCall)
      .map((p, i) => ({
        id: p.functionCall.id || `call_${Date.now()}_${i}`,
        name: p.functionCall.name,
        args: p.functionCall.args || {},
      }));

    return {
      text, toolCalls, truncated,
      usage: { prompt: um.promptTokenCount, completion: um.candidatesTokenCount, cached: um.cachedContentTokenCount },
      rawGemini: toolCalls.length ? parts : undefined,
    };
  }

  return { protocol: 'gemini', capabilities: caps, call, classifyError: classifyCommon };
}

module.exports = { create, toGeminiContents, toGeminiDeclaration };
