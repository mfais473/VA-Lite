const { countOccurrences } = require('../../shared/text');

function countLines(s) {
  if (!s) return 0;
  const n = s.split('\n').length;
  return s.endsWith('\n') ? n - 1 : n;
}

function eolOf(text) {
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/(?<!\r)\n/g) || []).length;
  return crlf > lf ? 'crlf' : 'lf';
}

const fitEol = (s, eol) => (eol === 'crlf' ? s.replace(/\r?\n/g, '\r\n') : s.replace(/\r\n/g, '\n'));

module.exports = { countLines, countOccurrences, eolOf, fitEol };
