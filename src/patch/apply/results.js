function failure(error, code, extra = {}) {
  return { success: false, error, code, ...extra };
}

function withRollback(base, rb) {
  if (rb.ok) return { ...base, rollback: rb, error: `${base.error}. Semua perubahan sudah dikembalikan.` };
  const names = rb.failures.map((f) => `${f.path} [${f.code}]`).join(', ');
  return {
    ...base,
    rollbackFailed: true,
    rollback: rb,
    error: `${base.error}. ROLLBACK GAGAL untuk: ${names}. Folder proyek mungkin dalam keadaan setengah berubah; periksa dengan git.`,
  };
}

module.exports = { failure, withRollback };
