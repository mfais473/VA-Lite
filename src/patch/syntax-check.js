const path = require('path');
const vm = require('vm');

const WRAP_PREFIX = '(function (exports, require, module, __filename, __dirname) {';
const WRAP_SUFFIX = '\n})';
const NOT_CJS = /Cannot use import statement|Unexpected token 'export'|import\.meta|await is only valid|Unexpected token '<'|Unexpected reserved word/;

const END_OF_INPUT = /end of JSON input|Unterminated|Unexpected end/i;

function failedAtEnd(message, prefix) {
  if (END_OF_INPUT.test(message)) return true;
  const p = /position (\d+)/.exec(message);
  return p ? Number(p[1]) >= prefix.trimEnd().length : false;
}

function jsonErrorLine(text) {
  const lines = text.split('\n');
  const bad = (k) => {
    const prefix = lines.slice(0, k).join('\n');
    try { JSON.parse(prefix); return false; } catch (e) { return !failedAtEnd(e.message, prefix); }
  };
  if (!bad(lines.length)) return lines.length;
  let lo = 1;
  let hi = lines.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bad(mid)) hi = mid; else lo = mid + 1;
  }
  return lo;
}

function jsonLine(message, text) {
  const m = /line (\d+)/.exec(message);
  if (m) return Number(m[1]);
  const p = /position (\d+)/.exec(message);
  if (p) return text.slice(0, Number(p[1])).split('\n').length;
  return jsonErrorLine(text);
}

function checkSyntax(rel, text) {
  const ext = path.posix.extname(String(rel)).toLowerCase();
  if (ext === '.json') {
    try {
      JSON.parse(text.replace(/^\uFEFF/, ''));
      return null;
    } catch (err) {
      return { message: `JSON tidak valid: ${err.message}`, line: jsonLine(err.message, text) };
    }
  }
  if (ext === '.js' || ext === '.cjs') {
    const body = text.replace(/^\uFEFF/, '').replace(/^#!.*/, '//');
    try {
      new vm.Script(WRAP_PREFIX + body + WRAP_SUFFIX, { filename: String(rel) });
      return null;
    } catch (err) {
      if (!(err instanceof SyntaxError) || NOT_CJS.test(err.message)) return null;
      const m = /:(\d+)\r?\n/.exec(err.stack || '');
      const line = m ? Number(m[1]) : null;
      const total = body.split('\n').length;
      if (line !== null && line > total) {
        return { message: 'Unexpected end of input (kurung atau kurawal kemungkinan tidak ditutup)', line: total };
      }
      return { message: err.message, line };
    }
  }
  return null;
}

function warningsFor(writes, limit = 5) {
  const out = [];
  for (const w of writes) {
    if (!w.after || !w.after.exists || !w.after.buf) continue;
    const after = checkSyntax(w.rel, w.after.buf.toString('utf8'));
    if (!after) continue;
    const before = w.before && w.before.exists && w.before.buf ? checkSyntax(w.rel, w.before.buf.toString('utf8')) : null;
    if (before) continue;
    out.push(`${w.rel}${after.line ? `:${after.line}` : ''}: ${after.message}`);
    if (out.length >= limit) break;
  }
  return out;
}

module.exports = { checkSyntax, warningsFor };
