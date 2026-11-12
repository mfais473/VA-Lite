const { renderNotes } = require('./turn-notes');

const MAX_TURNS = 10;
const NOTES_TURNS_KEPT = 3;

let history = [];

function getHistory() {
  const notesFrom = history.length - NOTES_TURNS_KEPT * 2;
  return history.map((m, i) => {
    const withNotes = m.role === 'assistant' && m.notes && m.notes.length && i >= notesFrom;
    return { role: m.role, content: withNotes ? m.content + renderNotes(m.notes) : m.content };
  });
}

function appendTurn(userText, assistantText, notes) {
  const u = (userText || '').trim();
  const a = (assistantText || '').trim();
  if (!u || !a) return;

  history.push({ role: 'user', content: u });
  const entry = { role: 'assistant', content: a };
  if (Array.isArray(notes) && notes.length) entry.notes = notes.map(String);
  history.push(entry);

  const maxMessages = MAX_TURNS * 2;
  if (history.length > maxMessages) {
    history = history.slice(history.length - maxMessages);
  }
}

function resetHistory() {
  history = [];
}

module.exports = { getHistory, appendTurn, resetHistory, MAX_TURNS, NOTES_TURNS_KEPT };
