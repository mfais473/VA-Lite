'use strict';

const clients = require('./clients');
const { TRUNCATED_ARGS_ERROR, stripImages, classifyCommon } = require('./common');

const DEFAULT_MAX_TOKENS = 8000;
const SDK_NON_STREAMING_CEILING = 21333;

function textBlock(text) {
  return { type: 'text', text };
}

function toAnthropicMessages(messages) {
  const out = [];
  let pending = null;
  const seenToolUse = new Set();

  const ensure = () => {
    if (!pending) pending = { results: [], others: [] };
    return pending;
  };
  const flush = () => {
    if (pending && (pending.results.length || pending.others.length)) {
      out.push({ role: 'user', content: [...pending.results, ...pending.others] });
    }
    pending = null;
  };

  for (const m of messages) {
    if (m.role === 'user') {
      const p = ensure();
      if (m.text) p.others.push(textBlock(m.text));
      for (const img of m.images || []) {
        p.others.push({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.data } });
      }
    } else if (m.role === 'note') {
      if (m.text) ensure().others.push(textBlock(m.text));
    } else if (m.role === 'tool') {
      if (!seenToolUse.has(m.toolCallId)) continue;
      ensure().results.push({ type: 'tool_result', tool_use_id: m.toolCallId, content: m.text || '' });
    } else if (m.role === 'assistant') {
      flush();
      let content;
      if (m.rawAnthropic && m.rawAnthropic.length) {
        content = m.rawAnthropic;
        for (const b of content) if (b && b.type === 'tool_use') seenToolUse.add(b.id);
      } else {
        content = [];
        if (m.text) content.push(textBlock(m.text));
        for (const c of m.toolCalls || []) {
          content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args || {} });
          seenToolUse.add(c.id);
        }
        if (!content.length) content.push(textBlock('(tidak ada jawaban)'));
      }
      out.push({ role: 'assistant', content });
    }
  }
  flush();
  return out;
}

function create(cfg) {
  const caps = cfg.capabilities || { images: false, tools: true };

  async function call({ system, messages, tools = [], model, maxTokens, signal, toolChoice }) {
    const client = clients.getClient('anthropic', { apiKey: cfg.apiKey, baseURL: cfg.baseURL, cacheId: cfg.id });
    const limit = Number(maxTokens) > 0 ? Math.min(Math.floor(Number(maxTokens)), SDK_NON_STREAMING_CEILING) : DEFAULT_MAX_TOKENS;
    const body = {
      model,
      max_tokens: limit,
      system,
      messages: toAnthropicMessages(caps.images ? messages : stripImages(messages)),
    };
    if (tools.length && caps.tools !== false) {
      body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
      if (toolChoice === 'none') body.tool_choice = { type: 'none' };
    }

    const resp = await client.messages.create(body, signal ? { signal } : undefined);
    const content = Array.isArray(resp.content) ? resp.content : [];
    const truncated = resp.stop_reason === 'max_tokens' || resp.stop_reason === 'model_context_window_exceeded';

    const text = content.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('');
    const toolCalls = content
      .filter((b) => b && b.type === 'tool_use')
      .map((b) => {
        const call = {
          id: b.id,
          name: b.name,
          args: b.input && typeof b.input === 'object' ? b.input : {},
        };
        if (truncated) call.argsError = TRUNCATED_ARGS_ERROR;
        return call;
      });

    const u = resp.usage || {};
    const usage = {
      prompt: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
      completion: u.output_tokens || 0,
      cached: u.cache_read_input_tokens || 0,
    };

    return { text, toolCalls, truncated, usage, rawAnthropic: toolCalls.length ? content : undefined };
  }

  return { protocol: 'anthropic', capabilities: caps, call, classifyError: classifyCommon };
}

module.exports = { create, toAnthropicMessages, DEFAULT_MAX_TOKENS };
