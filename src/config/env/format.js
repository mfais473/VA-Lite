function formatValue(value) {
  if (value !== '' && /^[A-Za-z0-9_.\-/:@+,~]+$/.test(value)) return value;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function parseValue(rawValue) {
  let v = rawValue.trim();
  if (v.startsWith('"')) {
    let out = '';
    for (let i = 1; i < v.length; i += 1) {
      const c = v[i];
      if (c === '\\' && i + 1 < v.length) {
        const n = v[i + 1];
        out += n === 'n' ? '\n' : n === 'r' ? '\r' : n;
        i += 1;
      } else if (c === '"') {
        return out;
      } else {
        out += c;
      }
    }
    return out;
  }
  if (v.startsWith("'")) {
    const end = v.indexOf("'", 1);
    return end === -1 ? v.slice(1) : v.slice(1, end);
  }
  const hash = v.search(/\s#/);
  if (hash !== -1) v = v.slice(0, hash);
  return v.trim();
}

const LINE_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=(.*)$/;

function parse(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = LINE_RE.exec(line);
    if (m) out[m[1]] = parseValue(m[2]);
  }
  return out;
}

module.exports = { formatValue, LINE_RE, parse };
