'use strict';

let factories = {};
const cache = new Map();

function pick(mod, name) {
  return mod && (mod.default || mod[name] || mod);
}

const DEFAULT_FACTORIES = {
  openai({ apiKey, baseURL }) {
    const OpenAI = pick(require('openai'), 'OpenAI');
    return new OpenAI({ apiKey, baseURL, maxRetries: 0 });
  },
  anthropic({ apiKey, baseURL }) {
    const Anthropic = pick(require('@anthropic-ai/sdk'), 'Anthropic');
    return new Anthropic({ apiKey, baseURL, maxRetries: 0 });
  },
  gemini({ apiKey }) {
    const { GoogleGenAI } = require('@google/genai');
    return new GoogleGenAI({ apiKey });
  },
};

function getClient(kind, { apiKey, baseURL, cacheId }) {
  const id = `${kind}:${cacheId || 'default'}`;
  const sig = `${baseURL || ''}\u0000${apiKey || ''}`;
  const hit = cache.get(id);
  if (hit && hit.sig === sig) return hit.client;
  const factory = factories[kind] || DEFAULT_FACTORIES[kind];
  if (!factory) throw new Error(`Protokol tidak dikenal: ${kind}`);
  const client = factory({ apiKey, baseURL });
  cache.set(id, { sig, client });
  return client;
}

function setFactoriesForTest(f) {
  factories = f || {};
  cache.clear();
}

function clearCache() {
  cache.clear();
}

module.exports = { getClient, setFactoriesForTest, clearCache };
