import { el } from '../dom.js';

const PHASES = [
  { key: 'primary', label: 'Model utama' },
  { key: 'followUp', label: 'Model lanjutan' },
  { key: 'coding', label: 'Model coding' },
];

function field(labelText, input, hint) {
  const wrap = el('label', 'via-set-field');
  wrap.append(el('span', 'via-set-label', labelText), input);
  if (hint) wrap.append(el('span', 'via-set-hint', hint));
  return wrap;
}

function textInput(value, placeholder, type = 'text') {
  const i = el('input', 'via-set-input');
  i.type = type;
  i.value = value || '';
  if (placeholder) i.placeholder = placeholder;
  i.autocomplete = 'off';
  i.spellcheck = false;
  return i;
}

function hostOf(url, fallback) {
  const s = String(url || '').trim();
  if (!s) return fallback || '';
  try { return new URL(s).host || '(tidak valid)'; } catch { return '(tidak valid)'; }
}

function setResult(node, ok, text) {
  node.textContent = text || '';
  node.classList.toggle('is-ok', Boolean(ok) && Boolean(text));
  node.classList.toggle('is-err', !ok && Boolean(text));
}

function menuItem(title, desc, { badges = [], onClick } = {}) {
  const b = el('button', 'via-set-menu');
  b.type = 'button';
  const text = el('span', 'via-set-menu-text');
  text.append(el('strong', null, title));
  if (desc) text.append(el('small', null, desc));
  b.append(text);
  for (const [label, muted] of badges) b.append(el('span', muted ? 'via-set-badge is-muted' : 'via-set-badge', label));
  b.append(el('span', 'via-set-chevron', '\u203a'));
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

function numberInput(value, placeholder) {
  const i = textInput(value, placeholder);
  i.inputMode = 'numeric';
  return i;
}

const KIND_TEXT = {
  auth: 'kunci ditolak', network: 'tidak terjangkau', model: 'model tidak dikenal',
  rate_limit: 'kena limit', overloaded: 'server sibuk', context: 'konteks terlalu panjang', other: 'gagal',
};

export { PHASES, field, textInput, numberInput, hostOf, setResult, menuItem, KIND_TEXT };
