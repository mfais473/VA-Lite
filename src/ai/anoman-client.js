const clients = require('./providers/clients');
const registry = require('./providers');

function getAnomanClient() {
  const cfg = registry.resolveForCall('anoman');
  return clients.getClient('openai', { apiKey: cfg.apiKey, baseURL: cfg.baseURL, cacheId: cfg.id });
}

module.exports = { getAnomanClient };
