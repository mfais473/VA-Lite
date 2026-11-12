const { ipcMain, app } = require('electron');
const { setExpanded, beginDrag, dragBy, endDrag, getMainWindow } = require('./window');
const { registerSettingsHandlers } = require('./settings-ipc');
const { appendTurn } = require('../ai/conversation-memory');
const agent = require('../agent/agent-loop');
const { shortcutDecision } = require('../agent/confirmation');
const { subscribeRateLimit } = require('../ai/llm-client');

const MAX_INPUT_CHARS = 4000;

let busy = false;

function toReply(outcome) {
  const text = String((outcome && outcome.rawText) || '').trim();
  if (!text) return null;
  if (outcome.done) appendTurn(outcome.userText, text, outcome.notes);
  return { text, awaitingConfirmation: !outcome.done };
}

function forwardRateLimit(sender) {
  return subscribeRateLimit((state) => {
    if (sender && !sender.isDestroyed()) sender.send('rate-limit-status', { waiting: Boolean(state.waiting) });
  });
}

function rememberPartialProgress(error) {
  const partial = agent.takePartialProgress();
  if (!partial) return;
  const why = String((error && error.message) || error || 'tidak diketahui').slice(0, 200);
  appendTurn(
    partial.userText,
    `(Giliran ini terhenti karena error: ${why}. Yang sudah dikerjakan sebelum error tercatat di catatan sistem; ` +
      'lanjutkan dari sana dan jangan mengulang yang sudah selesai.)',
    partial.notes,
  );
}

function errorMessage(error) {
  return error && error.message ? error.message : String(error);
}

function registerIpcHandlers() {
  ipcMain.on('app-quit', () => app.quit());

  registerSettingsHandlers({ ipcMain, getMainWindow, isBusy: () => busy, hasPending: () => agent.hasPending() });

  ipcMain.handle('window-set-expanded', (event, expanded) => setExpanded(Boolean(expanded)));
  ipcMain.on('window-drag-start', () => beginDrag());
  ipcMain.on('window-drag-move', (event, p) => dragBy(Number(p && p.dx), Number(p && p.dy)));
  ipcMain.on('window-drag-end', (event, p) => endDrag(Boolean(p && p.moved)));

  ipcMain.handle('chat-send', async (event, payload) => {
    const raw = payload && typeof payload.text === 'string' ? payload.text : '';
    const userText = raw.trim().slice(0, MAX_INPUT_CHARS);
    if (!userText) return { empty: true };
    if (busy) {
      console.warn('[chat-send] Masih memproses pesan sebelumnya, pesan baru ditolak.');
      return { busy: true };
    }
    busy = true;
    const stopRateNotice = forwardRateLimit(event.sender);
    try {
      const outcome = agent.hasPending()
        ? await agent.resume(userText)
        : await agent.startTurn(userText);
      return toReply(outcome) || { empty: true };
    } catch (error) {
      agent.cancelPending();
      rememberPartialProgress(error);
      console.error('Error saat memproses pesan:', error);
      return { error: errorMessage(error) };
    } finally {
      stopRateNotice();
      busy = false;
    }
  });

  ipcMain.handle('confirm-shortcut', async (event, payload) => {
    const parsed = shortcutDecision(payload);
    if (!parsed) return { noPending: true };
    if (busy) return { busy: true };
    if (!agent.hasPending()) return { noPending: true };
    busy = true;
    const stopRateNotice = forwardRateLimit(event.sender);
    try {
      const outcome = await agent.answerPending(parsed.decision);
      if (!outcome) return { noPending: true };
      return toReply(outcome) || { empty: true };
    } catch (error) {
      agent.cancelPending();
      rememberPartialProgress(error);
      console.error('Error saat memproses jawaban izin:', error);
      return { error: errorMessage(error) };
    } finally {
      stopRateNotice();
      busy = false;
    }
  });
}

module.exports = { registerIpcHandlers, __test: { toReply, rememberPartialProgress } };
