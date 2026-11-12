const { MAX_SAME_FAILURES } = require('./constants');
const { HALTED_RESULT } = require('./messages');

function trackFailure(run, call) {
  const r = call.result;
  if (!r || r.denied || r.halted) return;
  if (!run.failures) run.failures = {};
  if (r.success !== false) {
    for (const k of Object.keys(run.failures)) if (k.startsWith(`${call.name}|`)) delete run.failures[k];
    return;
  }
  const key = `${call.name}|${String(r.error || '').replace(/\d+/g, '#').slice(0, 80)}`;
  run.failures[key] = (run.failures[key] || 0) + 1;
  const n = run.failures[key];
  if (n >= MAX_SAME_FAILURES) {
    run.halted = true;
    run.toolsEnabled = false;
    console.warn(`[agent] DIHENTIKAN: ${call.name} gagal ${n} kali dengan penyebab yang sama: ${String(r.error || '').slice(0, 120)}`);
    call.result = {
      ...HALTED_RESULT,
      code: 'REPEATED_FAILURE',
      error:
        `${call.name} gagal ${n} kali dengan penyebab yang sama (${String(r.error || '').slice(0, 120)}). Pekerjaan DIHENTIKAN ` +
        'agar tidak membuang token. Jangan memanggil tool lagi; jelaskan singkat ke pengguna apa yang gagal dan ' +
        'apa yang perlu diubah (mis. bagian file yang lebih kecil atau jelas).',
    };
  } else if (n === 2) {
    call.result = {
      ...r,
      hint: 'Kegagalan yang sama sudah terjadi 2 kali. Jangan ulangi cara yang sama: baca ulang bagian yang relevan, ' +
        'perkecil langkahnya, atau tanyakan ke pengguna.',
    };
  }
}

module.exports = { trackFailure };
