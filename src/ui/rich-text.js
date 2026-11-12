import { el } from './dom.js';

function appendInline(parent, text) {
  const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
    const token = m[0];
    if (token.startsWith('`')) parent.appendChild(el('code', 'via-inline', token.slice(1, -1)));
    else parent.appendChild(el('strong', null, token.slice(2, -2)));
    last = m.index + token.length;
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}

function renderRich(target, raw) {
  const text = String(raw == null ? '' : raw).replace(/\r\n/g, '\n');
  text.split('```').forEach((part, i) => {
    if (i % 2 === 1) {
      const code = part.replace(/^[\w+#.-]*\n/, '').replace(/\n$/, '');
      const pre = el('pre', 'via-code');
      pre.appendChild(el('code', null, code));
      target.appendChild(pre);
    } else if (part.trim()) {
      const p = el('div', 'via-par');
      appendInline(p, part.trim());
      target.appendChild(p);
    }
  });
}

export { renderRich };
