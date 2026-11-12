const artifacts = require('../../tools/session-artifacts');
const workspace = require('../../workspace/workspace');
const picked = require('../../tools/picked-access');
const planGate = require('../plan-gate');
const { CODING_PROMPT } = require('../../ai/coding-prompt');
const { getHistory } = require('../../ai/conversation-memory');
const { CONTEXT_HEADER } = require('./messages');

function historyMessages() {
  return getHistory().map((m) => ({ role: m.role, text: m.content }));
}

function dynamicContext(run) {
  return artifacts.renderBlock() + picked.renderBlock() + workspace.renderBlock() +
    (run.codingActive ? CODING_PROMPT + planGate.renderBlock() : '');
}

function syncContextNote(run) {
  const dyn = dynamicContext(run);
  if (dyn === run.lastContext) return;
  run.lastContext = dyn;
  run.messages.push({
    role: 'note',
    text: `${CONTEXT_HEADER}${dyn.trim() ? dyn : '\n(tidak ada konteks tambahan yang aktif)'}`,
  });
}

module.exports = { historyMessages, dynamicContext, syncContextNote };
