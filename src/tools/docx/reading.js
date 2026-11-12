const { W, MC, isW, elementChildren, childW } = require('./xml');

function blocksOf(body) {
  const out = [];
  const walk = (parent) => {
    for (const el of elementChildren(parent)) {
      if (isW(el, 'p')) out.push({ kind: 'p', node: el });
      else if (isW(el, 'tbl')) out.push({ kind: 'table', node: el });
      else if (isW(el, 'sdt')) {
        const content = childW(el, 'sdtContent');
        if (content) walk(content);
      }
    }
  };
  walk(body);
  return out;
}

const SKIP_IN_TEXT = new Set(['pPr', 'rPr', 'sectPr', 'txbxContent', 'del', 'moveFrom']);

function walkText(node, fn) {
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.nodeType !== 1) continue;
    if (c.namespaceURI === W) {
      if (SKIP_IN_TEXT.has(c.localName)) continue;
      if (['t', 'tab', 'br', 'cr', 'noBreakHyphen'].includes(c.localName)) { fn(c); continue; }
    } else if (c.namespaceURI === MC && c.localName === 'Fallback') {
      continue;
    }
    walkText(c, fn);
  }
}

function paragraphText(p) {
  let s = '';
  walkText(p, (el) => {
    switch (el.localName) {
      case 't': s += el.textContent; break;
      case 'tab': s += '\t'; break;
      case 'br': case 'cr': s += '\n'; break;
      case 'noBreakHyphen': s += '-'; break;
      default: break;
    }
  });
  return s;
}

function pPrOf(p) {
  return childW(p, 'pPr');
}

function styleIdOf(p) {
  const ppr = pPrOf(p);
  const ps = ppr && childW(ppr, 'pStyle');
  return ps ? ps.getAttributeNS(W, 'val') || '' : '';
}

function headingLevel(p) {
  const id = styleIdOf(p);
  const m = /^(?:Heading|Judul)\s*([1-9])$/i.exec(id);
  if (m) return Number(m[1]);
  if (/^Title$/i.test(id)) return 0;
  const ppr = pPrOf(p);
  const ol = ppr && childW(ppr, 'outlineLvl');
  if (ol) {
    const v = parseInt(ol.getAttributeNS(W, 'val'), 10);
    if (v >= 0 && v <= 8) return v + 1;
  }
  return null;
}

function isListItem(p) {
  const ppr = pPrOf(p);
  return !!(ppr && childW(ppr, 'numPr'));
}

const tableRows = (tbl) => elementChildren(tbl).filter((c) => isW(c, 'tr'));

const rowCells = (tr) => elementChildren(tr).filter((c) => isW(c, 'tc'));

const cellParagraphs = (tc) => elementChildren(tc).filter((c) => isW(c, 'p'));

const cellText = (tc) => cellParagraphs(tc).map(paragraphText).join('\n');

function tableMatrix(tbl) {
  return tableRows(tbl).map((tr) => rowCells(tr).map(cellText));
}

function countDeep(root, localName) {
  return root.getElementsByTagNameNS(W, localName).length;
}

function summarize(opened) {
  const blocks = blocksOf(opened.body);
  const headings = [];
  let paragraphs = 0;
  let tables = 0;
  blocks.forEach((b, i) => {
    if (b.kind === 'table') { tables += 1; return; }
    paragraphs += 1;
    const level = headingLevel(b.node);
    if (level !== null) {
      const text = paragraphText(b.node).replace(/\s+/g, ' ').trim();
      if (text) headings.push({ n: i + 1, level, text });
    }
  });
  return {
    blocks: blocks.length,
    paragraphs,
    tables,
    headings,
    features: {
      trackedChanges: countDeep(opened.body, 'ins') + countDeep(opened.body, 'del') > 0,
      images: countDeep(opened.body, 'drawing') + countDeep(opened.body, 'pict'),
      comments: !!opened.zip.file('word/comments.xml'),
    },
  };
}

module.exports = {
  blocksOf, SKIP_IN_TEXT, walkText, paragraphText, pPrOf, styleIdOf, headingLevel, isListItem,
  tableRows, rowCells, cellParagraphs, cellText, tableMatrix, countDeep, summarize,
};
