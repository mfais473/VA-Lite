const { DOMParser } = require('@xmldom/xmldom');

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const XMLNS = 'http://www.w3.org/XML/1998/namespace';
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

function isW(n, name) {
  return !!n && n.nodeType === 1 && n.namespaceURI === W && n.localName === name;
}

function elementChildren(n) {
  const out = [];
  for (let c = n.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(c);
  return out;
}

function childW(n, name) {
  return elementChildren(n).find((c) => isW(c, name)) || null;
}

function createW(doc, name) {
  return doc.createElementNS(W, 'w:' + name);
}

function parseXml(str) {
  const errors = [];
  const dom = new DOMParser({
    errorHandler: { warning() {}, error(m) { errors.push(m); }, fatalError(m) { errors.push(m); } },
  }).parseFromString(str, 'text/xml');
  if (errors.length || !dom || !dom.documentElement) throw new Error('XML dalam dokumen rusak atau tidak bisa dibaca');
  return dom;
}

function sanitizeText(s) {
  return String(s === null || s === undefined ? '' : s).replace(/\r\n?/g, '\n').replace(INVALID_XML_CHARS, '');
}

module.exports = { W, MC, XMLNS, isW, elementChildren, childW, createW, parseXml, sanitizeText };
