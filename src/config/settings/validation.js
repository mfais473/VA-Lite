const registry = require('../../ai/providers');
const { redact, collectSecrets } = require('../../ai/providers/common');

const MAX_KEY_CHARS = 512;

const fail = (error, extra) => ({ ok: false, error, ...(extra || {}) });

function safeMessage(err) {
  return redact((err && err.message) || 'Terjadi kesalahan', collectSecrets()).slice(0, 300);
}

function validateApiKey(key) {
  if (typeof key !== 'string') return 'Kunci harus berupa teks';
  const k = key.trim();
  if (!k || k.length > MAX_KEY_CHARS) return 'Kunci kosong atau terlalu panjang';
  if (/[\s\u0000-\u001f\u007f]/.test(k)) return 'Kunci tidak boleh mengandung spasi atau karakter kontrol';
  return null;
}

function guardActive(id, ctx) {
  const busy = ctx && ((ctx.isBusy && ctx.isBusy()) || (ctx.hasPending && ctx.hasPending()));
  if (busy && registry.activeId() === id) {
    return 'Provider yang sedang aktif tidak bisa diubah saat Via bekerja atau menunggu izin. Selesaikan dulu giliran ini.';
  }
  return null;
}

module.exports = { fail, safeMessage, validateApiKey, guardActive };
