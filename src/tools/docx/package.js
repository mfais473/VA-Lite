const JSZip = require('jszip');
const { XMLSerializer } = require('@xmldom/xmldom');
const { W, isW, elementChildren, parseXml } = require('./xml');

const DOC_PATH = 'word/document.xml';
const STYLES_PATH = 'word/styles.xml';
const MAX_XML_BYTES = 50 * 1024 * 1024;

async function openDocx(buffer) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new Error('Bukan file .docx yang valid (bukan arsip ZIP)');
  }
  const entry = zip.file(DOC_PATH);
  if (!entry) throw new Error('Bukan file .docx yang valid (word/document.xml tidak ada)');
  const declared = entry._data && entry._data.uncompressedSize;
  if (declared && declared > MAX_XML_BYTES) throw new Error('Isi dokumen terlalu besar untuk diproses');
  const xml = await entry.async('string');
  if (xml.length > MAX_XML_BYTES) throw new Error('Isi dokumen terlalu besar untuk diproses');
  const dom = parseXml(xml);
  const body = elementChildren(dom.documentElement).find((c) => isW(c, 'body'));
  if (!body) throw new Error('Bukan file .docx yang valid (w:body tidak ada)');
  return { zip, dom, body };
}

async function saveDocx(opened) {
  let xml = new XMLSerializer().serializeToString(opened.dom);
  if (!xml.startsWith('<?xml')) xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + xml;
  opened.zip.file(DOC_PATH, xml);
  return opened.zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

async function styleIdsOf(zip) {
  const f = zip.file(STYLES_PATH);
  if (!f) return new Set();
  try {
    const dom = parseXml(await f.async('string'));
    const ids = new Set();
    for (const s of Array.from(dom.getElementsByTagNameNS(W, 'style'))) {
      const id = s.getAttributeNS(W, 'styleId');
      if (id) ids.add(id);
    }
    return ids;
  } catch {
    return new Set();
  }
}

module.exports = { DOC_PATH, openDocx, saveDocx, styleIdsOf };
