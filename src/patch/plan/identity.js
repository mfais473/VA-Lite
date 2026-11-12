const crypto = require('crypto');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';

const pathKey = (rel) => (CASE_INSENSITIVE ? rel.toLowerCase() : rel);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

module.exports = { sha256, pathKey, canonical };
