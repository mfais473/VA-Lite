const { CONFIRM_TTL_MS, INQUIRY_TTL_MS } = require('./constants');

const state = {
  now: () => Date.now(),
  pending: null,
  currentRun: null,
};

function hasPending() {
  if (state.pending) {
    const ttl = state.pending.kind === 'inquiry' ? INQUIRY_TTL_MS : CONFIRM_TTL_MS;
    if (state.now() - state.pending.askedAt > ttl) state.pending = null;
  }
  return state.pending !== null;
}

function cancelPending() {
  state.pending = null;
}

function takePartialProgress() {
  const r = state.currentRun;
  state.currentRun = null;
  if (!r || !Array.isArray(r.notes) || !r.notes.length) return null;
  return { userText: r.userText, notes: r.notes.slice() };
}

function setNow(fn) {
  state.now = fn;
}

function reset() {
  state.now = () => Date.now();
  state.pending = null;
  state.currentRun = null;
}

module.exports = { state, hasPending, cancelPending, takePartialProgress, setNow, reset };
