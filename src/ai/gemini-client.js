const clients = require('./providers/clients');
const registry = require('./providers');

function getGeminiClient() {
  const cfg = registry.resolveForCall('gemini');
  return clients.getClient('gemini', { apiKey: cfg.apiKey, cacheId: cfg.id });
}

module.exports = { getGeminiClient };
