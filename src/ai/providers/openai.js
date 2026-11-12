'use strict';

const clients = require('./clients');
const { TRUNCATED_ARGS_ERROR, stripImages, classifyCommon } = require('./common');
const { parseRateHeaders } = require('../rate-headers');

function toOpenAIMessages(system, messages) {
  const out = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') {
      if (m.images && m.images.length) {
        out.push({
          role: 'user',
          content: [
            { type: 'text', text: m.text || '' },
            ...m.images.map((img) => ({
              type: 'image_url',
              image_url: { url: `data:${img.mimeType};base64,${img.data}` },
            })),
          ],
        });
      } else {
        out.push({ role: 'user', content: m.text || '' });
      }
    } else if (m.role === 'note') {
      out.push({ role: 'user', content: m.text || '' });
    } else if (m.role === 'assistant') {
      const msg = { role: 'assistant', content: m.text || (m.toolCalls && m.toolCalls.length ? null : '') };
      if (m.toolCalls && m.toolCalls.length) {
        msg.tool_calls = m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.args || {}) },
        }));
      }
      out.push(msg);
    } else if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.text || '' });
    }
  }
  return out;
}

function create(cfg) {
  const caps = cfg.capabilities || { images: false, tools: true };

  async function call({ system, messages, tools = [], model, maxTokens, signal, toolChoice }) {
    const client = clients.getClient('openai', { apiKey: cfg.apiKey, baseURL: cfg.baseURL, cacheId: cfg.id });
    const body = { model, messages: toOpenAIMessages(system, caps.images ? messages : stripImages(messages)) };
    if (maxTokens) body[cfg.tokenParam || 'max_tokens'] = maxTokens;
    if (tools.length && caps.tools !== false && toolChoice !== 'none') {
      body.tools = tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      body.tool_choice = 'auto';
    }
    if (cfg.extraBody) Object.assign(body, cfg.extraBody);

    const pending = client.chat.completions.create(body, signal ? { signal } : undefined);
    let resp;
    let rate = null;
    if (pending && typeof pending.withResponse === 'function') {
      const full = await pending.withResponse();
      resp = full.data;
      rate = parseRateHeaders(full.response && full.response.headers);
    } else {
      resp = await pending;
    }
    const choice = (resp.choices && resp.choices[0]) || {};
    const msg = choice.message || {};
    const truncated = choice.finish_reason === 'length';
    const u = resp.usage || {};
    const usage = {
      prompt: u.prompt_tokens || 0,
      completion: u.completion_tokens || 0,
      cached: (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) ||
        u.cache_read_input_tokens || u.prompt_cache_hit_tokens || 0,
    };

    let text = msg.content || '';
    if (Array.isArray(text)) text = text.map((p) => p.text || '').join('');

    const toolCalls = (msg.tool_calls || [])
      .filter((tc) => tc.function)
      .map((tc, i) => {
        let args = {};
        let argsError;
        try {
          args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          argsError = truncated ? TRUNCATED_ARGS_ERROR : 'Argumen tool bukan JSON yang valid';
        }
        return { id: tc.id || `call_${Date.now()}_${i}`, name: tc.function.name, args, argsError };
      });

    return { text, toolCalls, truncated, usage, rate };
  }

  return { protocol: 'openai', capabilities: caps, call, classifyError: classifyCommon };
}

module.exports = { create, toOpenAIMessages };
