const { W, XMLNS, isW } = require('./xml');
const { walkText } = require('./reading');

function textNodesOf(p) {
  const out = [];
  walkText(p, (el) => { if (el.localName === 't') out.push(el); });
  return out;
}

function setTextNode(doc, t, s) {
  while (t.firstChild) t.removeChild(t.firstChild);
  t.appendChild(doc.createTextNode(s));
  t.setAttributeNS(XMLNS, 'xml:space', 'preserve');
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesIn(full, find, matchCase) {
  const re = new RegExp(escapeRegExp(find), matchCase ? 'g' : 'gi');
  const out = [];
  let m;
  while ((m = re.exec(full)) !== null) {
    out.push([m.index, m.index + m[0].length]);
    if (m[0].length === 0) re.lastIndex += 1;
  }
  return out;
}

function countInParagraph(p, find, matchCase) {
  return matchesIn(textNodesOf(p).map((t) => t.textContent).join(''), find, matchCase).length;
}

function replaceInParagraph(doc, p, find, replacement, matchCase) {
  const nodes = textNodesOf(p);
  const full = nodes.map((t) => t.textContent).join('');
  const found = matchesIn(full, find, matchCase);
  for (let k = found.length - 1; k >= 0; k--) {
    const [s, e] = found[k];
    let pos = 0;
    let first = -1;
    let last = -1;
    const starts = nodes.map((t) => { const st = pos; pos += t.textContent.length; return st; });
    nodes.forEach((t, i) => {
      const len = t.textContent.length;
      if (first === -1 && len > 0 && starts[i] <= s && s < starts[i] + len) first = i;
      if (len > 0 && starts[i] < e && e <= starts[i] + len) last = i;
    });
    if (first === -1 || last === -1) continue;
    const a = nodes[first].textContent;
    if (first === last) {
      setTextNode(doc, nodes[first], a.slice(0, s - starts[first]) + replacement + a.slice(e - starts[first]));
    } else {
      setTextNode(doc, nodes[first], a.slice(0, s - starts[first]) + replacement);
      for (let i = first + 1; i < last; i++) setTextNode(doc, nodes[i], '');
      setTextNode(doc, nodes[last], nodes[last].textContent.slice(e - starts[last]));
    }
  }
  return found.length;
}

function paragraphsOfBlock(block) {
  return block.kind === 'p' ? [block.node] : Array.from(block.node.getElementsByTagNameNS(W, 'p'))
    .filter((p) => {
      for (let a = p.parentNode; a && a !== block.node; a = a.parentNode) if (isW(a, 'txbxContent')) return false;
      return true;
    });
}

module.exports = { textNodesOf, countInParagraph, replaceInParagraph, paragraphsOfBlock };
