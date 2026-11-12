import { createLogo } from './logo.js';
import { createSettingsPanel } from './settings-panel.js';
import { el, iconButton } from './dom.js';
import { ICONS } from './icons.js';
import { renderRich } from './rich-text.js';
import { wireBubble } from './bubble.js';

const MAX_INPUT_CHARS = 4000;
const MAX_INPUT_HEIGHT_PX = 120;
const MIN_INPUT_HEIGHT_PX = 44;

const GREETING =
  'Halo! Aku Via. Ketik perintah atau pertanyaanmu di sini, misalnya "buka youtube", ' +
  '"baca pdf", atau "ubah gambar jadi Excel". Kalau aku butuh izin, aku akan bertanya dulu.';

const CHOICES = [
  { decision: 'approve', label: 'Ya', primary: true },
  { decision: 'deny', label: 'Tidak', primary: false },
  { decision: 'ask', label: 'Tanya dulu', primary: false },
];

let root = null;
let logEl = null;
let inputEl = null;
let sendBtn = null;
let bubbleBtn = null;
let typingEl = null;
let settingsPanel = null;
let providerLabelEl = null;
let panelEl = null;
let isOpen = false;
let isBusy = false;
let isSwitching = false;

function scrollToEnd() {
  logEl.scrollTop = logEl.scrollHeight;
}

function addMessage(kind, text, { confirm = false } = {}) {
  const row = el('div', `via-msg via-msg-${kind}`);
  const body = el('div', 'via-msg-body');
  if (kind === 'bot') renderRich(body, text);
  else body.textContent = text;
  row.appendChild(body);
  if (confirm) row.appendChild(createChoices());
  logEl.appendChild(row);
  scrollToEnd();
  return row;
}

function showTyping() {
  if (typingEl) return;
  typingEl = el('div', 'via-msg via-msg-bot via-typing');
  const body = el('div', 'via-msg-body');
  body.setAttribute('aria-label', 'Via sedang mengetik');
  body.append(el('i'), el('i'), el('i'));
  typingEl.appendChild(body);
  logEl.appendChild(typingEl);
  scrollToEnd();
}

function hideTyping() {
  if (!typingEl) return;
  typingEl.remove();
  typingEl = null;
}

const RATE_LIMIT_NOTE = 'Limit pemakaian per menit tercapai, saya akan menyesuaikan kecepatan';

function setTypingNote(text) {
  if (!typingEl) return;
  const body = typingEl.querySelector('.via-msg-body');
  typingEl.classList.toggle('has-note', Boolean(text));
  if (text) {
    body.replaceChildren(document.createTextNode(text));
    body.setAttribute('aria-label', text);
  } else {
    body.replaceChildren(el('i'), el('i'), el('i'));
    body.setAttribute('aria-label', 'Via sedang mengetik');
  }
  scrollToEnd();
}

function createChoices() {
  const box = el('div', 'via-choices');
  for (const choice of CHOICES) {
    const b = el('button', choice.primary ? 'via-choice is-primary' : 'via-choice', choice.label);
    b.type = 'button';
    b.dataset.decision = choice.decision;
    b.addEventListener('click', () => answerPermission(choice));
    box.appendChild(b);
  }
  return box;
}

function lockChoices() {
  logEl.querySelectorAll('.via-choice').forEach((b) => { b.disabled = true; });
}

async function answerPermission(choice) {
  if (isBusy) return;
  lockChoices();
  addMessage('user', choice.label);
  await roundTrip(() => window.api.confirmShortcut(choice.decision));
}

function setBusy(busy) {
  isBusy = busy;
  root.classList.toggle('is-busy', busy);
  sendBtn.disabled = busy;
  if (busy) showTyping();
  else hideTyping();
}

function markUnread(needsAnswer) {
  if (isOpen) return;
  bubbleBtn.classList.add('has-unread');
  bubbleBtn.classList.toggle('needs-answer', needsAnswer);
  bubbleBtn.setAttribute('aria-label', needsAnswer ? 'Via menunggu jawabanmu, buka chat' : 'Ada balasan baru dari Via, buka chat');
}

function clearUnread() {
  bubbleBtn.classList.remove('has-unread', 'needs-answer');
  bubbleBtn.setAttribute('aria-label', 'Buka chat Via');
}

function showResult(res) {
  if (!res || res.empty) {
    addMessage('note', 'Via belum punya balasan untuk itu. Coba tulis ulang ya.');
  } else if (res.busy) {
    addMessage('note', 'Via masih memproses pesan sebelumnya. Tunggu sebentar ya.');
  } else if (res.noPending) {
    addMessage('note', 'Permintaan izin tadi sudah tidak berlaku. Minta ulang saja ya.');
  } else if (res.error) {
    addMessage('error', `Maaf, terjadi kesalahan: ${res.error}`);
  } else {
    addMessage('bot', res.text, { confirm: Boolean(res.awaitingConfirmation) });
    markUnread(Boolean(res.awaitingConfirmation));
  }
}

async function roundTrip(call) {
  setBusy(true);
  let res;
  try {
    res = await call();
  } catch (err) {
    res = { error: err && err.message ? err.message : String(err) };
  }
  setBusy(false);
  showResult(res);
}

function autosizeInput() {
  if (!inputEl || !inputEl.offsetParent) return;

  inputEl.style.height = 'auto';
  const raw = inputEl.scrollHeight;
  const h = Math.min(Math.max(raw, MIN_INPUT_HEIGHT_PX), MAX_INPUT_HEIGHT_PX);
  inputEl.style.height = `${h}px`;
  inputEl.style.overflowY = raw > MAX_INPUT_HEIGHT_PX ? 'auto' : 'hidden';
}

async function submit() {
  const text = inputEl.value.trim();
  if (!text || isBusy) return;
  inputEl.value = '';
  autosizeInput();
  lockChoices();
  addMessage('user', text);
  await roundTrip(() => window.api.sendMessage(text));
}

async function expand() {
  root.classList.add('is-switching');
  try {
    const placement = await window.api.setExpanded(true);
    root.dataset.h = placement.h;
    root.dataset.v = placement.v;
    root.classList.add('is-open');
    isOpen = true;
    clearUnread();
  } finally {
    requestAnimationFrame(() => {
      root.classList.remove('is-switching');
      if (isOpen) {
        autosizeInput();
        inputEl.focus();
      }
    });
  }
}

async function collapse() {
  root.classList.remove('is-open');
  isOpen = false;
  await window.api.setExpanded(false);
}

async function toggle() {
  if (isSwitching) return;
  isSwitching = true;
  try {
    if (isOpen) await collapse();
    else await expand();
  } catch (err) {
    console.error('Gagal membuka/menutup panel:', err);
  } finally {
    isSwitching = false;
  }
}

function toggleSettings(force) {
  if (!panelEl || !settingsPanel) return;
  const show = typeof force === 'boolean' ? force : !panelEl.classList.contains('is-settings');
  panelEl.classList.toggle('is-settings', show);
  if (show) settingsPanel.refresh();
  else if (inputEl) inputEl.focus();
}

export function initChat() {
  if (root) return;

  root = el('div');
  root.id = 'via-app';
  root.dataset.h = 'right';
  root.dataset.v = 'bottom';

  const panel = el('section', 'via-panel');
  panel.setAttribute('aria-label', 'Chat dengan Via');
  panelEl = panel;

  const head = el('header', 'via-head');
  const headLogo = createLogo();
  headLogo.classList.add('via-head-logo');
  const title = el('div', 'via-head-title');
  providerLabelEl = el('small', null, 'Asisten virtual');
  title.append(el('strong', null, 'VA-Lite'), providerLabelEl);
  const collapseBtn = iconButton('via-icon-btn', 'Tutup chat (Esc)', ICONS.collapse);
  collapseBtn.addEventListener('click', () => { if (isOpen) toggle(); });
  const quitBtn = iconButton('via-icon-btn', 'Keluar dari aplikasi', ICONS.quit);
  quitBtn.addEventListener('click', () => window.api.quitApp());
  if (typeof window.api.onRateLimit === 'function') {
    window.api.onRateLimit(({ waiting }) => setTypingNote(waiting ? RATE_LIMIT_NOTE : null));
  }
  const settingsBtn = iconButton('via-icon-btn', 'Pengaturan', ICONS.gear);
  settingsBtn.addEventListener('click', () => toggleSettings());
  head.append(headLogo, title, settingsBtn, collapseBtn, quitBtn);

  logEl = el('div', 'via-log');
  logEl.setAttribute('role', 'log');
  logEl.setAttribute('aria-live', 'polite');

  const composer = el('div', 'via-composer');
  inputEl = el('textarea', 'via-input');
  inputEl.rows = 1;
  inputEl.maxLength = MAX_INPUT_CHARS;
  inputEl.placeholder = 'Ketik perintah atau pertanyaan…';
  inputEl.setAttribute('aria-label', 'Pesan untuk Via');
  inputEl.addEventListener('input', autosizeInput);
  inputEl.addEventListener('focus', autosizeInput);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  });
  sendBtn = iconButton('via-send', 'Kirim (Enter)', ICONS.send);
  sendBtn.addEventListener('click', submit);
  composer.append(inputEl, sendBtn);

  settingsPanel = createSettingsPanel({
    isBusy: () => isBusy,
    onClose: () => toggleSettings(false),
    onActiveChange: (label) => { if (providerLabelEl) providerLabelEl.textContent = `Asisten virtual · ${label}`; },
  });
  panel.append(head, logEl, composer, settingsPanel.el);
  if (window.api.settings) settingsPanel.refresh();

  bubbleBtn = el('button', 'via-bubble');
  bubbleBtn.type = 'button';
  bubbleBtn.title = 'VA-Lite';
  bubbleBtn.setAttribute('aria-label', 'Buka chat Via');
  bubbleBtn.append(createLogo(), el('span', 'via-dot'));
  wireBubble(bubbleBtn, toggle);

  root.append(panel, bubbleBtn);
  document.body.appendChild(root);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen && e.isTrusted) {
      e.preventDefault();
      toggle();
    }
  });

  addMessage('bot', GREETING);
  autosizeInput();

  panel.addEventListener('animationend', () => {
    if (isOpen) autosizeInput();
  });
}
