const outputLimit = require('../../ai/output-limit');
const { state } = require('./state');

function permissionPrompt(question, reason) {
  const why = reason ? ` Alasanku: ${reason}.` : '';
  return `${question}${why} Klik Ya, Tidak, atau Tanya dulu, atau ketik jawabanmu.`;
}

function askResult(run, question) {
  return { done: false, rawText: question, userText: run.userText };
}

function truncationGiveUp(run, phase, what) {
  const lim = outputLimit.resolveForPhase(phase);
  const where = lim.mode === 'custom'
    ? `Batas keluaran saat ini ${lim.value} token; naikkan di Pengaturan > Batas keluaran model, atau pecah tugasnya menjadi bagian yang lebih kecil.`
    : 'Via tidak mengirim batas, jadi batas ini berasal dari model atau penyedia; pecah tugasnya menjadi bagian yang lebih kecil, atau atur batas sendiri di Pengaturan > Batas keluaran model.';
  const done = run.executed.length
    ? ` ${run.executed.length} langkah tool yang sudah kujalankan tetap berlaku (mis. patch yang sudah diterapkan tidak dibatalkan).`
    : '';
  return `Keluaran model terpotong berulang kali (${what}), jadi aku berhenti di sini.${done} ${where}`;
}

function doneResult(run, rawText) {
  if (state.currentRun === run) state.currentRun = null;
  let text = rawText && rawText.trim();
  if (!text && (run.executed.length || run.denied || run.halted)) {
    text = 'Hmm, aku belum berhasil menyusun jawabannya. Coba tanya lagi ya.';
  }
  return { done: true, rawText: text || '', userText: run.userText, notes: run.notes || [] };
}

module.exports = { permissionPrompt, askResult, truncationGiveUp, doneResult };
