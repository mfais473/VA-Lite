const { W, XMLNS, isW, elementChildren, childW, createW, sanitizeText } = require('./xml');
const { SKIP_IN_TEXT, pPrOf, countDeep } = require('./reading');

function textElement(doc, s) {
  const t = createW(doc, 't');
  t.setAttributeNS(XMLNS, 'xml:space', 'preserve');
  t.appendChild(doc.createTextNode(s));
  return t;
}

function buildRun(doc, text, rPr) {
  const r = createW(doc, 'r');
  if (rPr) r.appendChild(rPr.cloneNode(true));
  for (const part of sanitizeText(text).split(/(\n|\t)/)) {
    if (part === '\n') r.appendChild(createW(doc, 'br'));
    else if (part === '\t') r.appendChild(createW(doc, 'tab'));
    else if (part !== '') r.appendChild(textElement(doc, part));
  }
  return r;
}

function firstRunProps(p) {
  let result = null;
  let done = false;
  const visit = (node) => {
    for (let c = node.firstChild; c && !done; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      if (isW(c, 'r')) { result = childW(c, 'rPr'); done = true; return; }
      if (c.namespaceURI === W && SKIP_IN_TEXT.has(c.localName)) continue;
      visit(c);
    }
  };
  visit(p);
  return result;
}

function complexityOf(p) {
  const checks = [
    ['drawing', 'gambar/objek'], ['pict', 'gambar/objek'], ['object', 'objek tertanam'],
    ['fldChar', 'field (mis. nomor halaman/daftar isi)'], ['fldSimple', 'field'],
    ['footnoteReference', 'catatan kaki'], ['endnoteReference', 'catatan akhir'],
  ];
  for (const [tag, label] of checks) if (countDeep(p, tag) > 0) return label;
  const ppr = pPrOf(p);
  if (ppr && childW(ppr, 'sectPr')) return 'pemisah seksi';
  return null;
}

const KEEP_IN_PARAGRAPH = new Set(['pPr', 'bookmarkStart', 'bookmarkEnd', 'commentRangeStart', 'commentRangeEnd']);

function setParagraphText(doc, p, text) {
  const why = complexityOf(p);
  if (why) throw new Error(`paragraf berisi ${why}; pakai replace_text untuk mengubah sebagian teksnya`);
  const rPr = firstRunProps(p);
  for (const c of elementChildren(p)) {
    if (!(c.namespaceURI === W && KEEP_IN_PARAGRAPH.has(c.localName))) p.removeChild(c);
  }
  p.appendChild(buildRun(doc, text, rPr));
}

function newParagraph(doc, text, { styleId, rPr } = {}) {
  const p = createW(doc, 'p');
  if (styleId) {
    const ppr = createW(doc, 'pPr');
    const ps = createW(doc, 'pStyle');
    ps.setAttributeNS(W, 'w:val', styleId);
    ppr.appendChild(ps);
    p.appendChild(ppr);
  }
  p.appendChild(buildRun(doc, text, rPr));
  return p;
}

module.exports = { textElement, buildRun, firstRunProps, complexityOf, setParagraphText, newParagraph };
