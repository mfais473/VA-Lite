const { LIMITS, OP_KINDS } = require('./limits');

function parseOperations(input) {
  let list = input;
  if (typeof input === 'string') {
    try { list = JSON.parse(input); } catch { return { error: 'operations bukan JSON yang valid' }; }
  }
  if (list && !Array.isArray(list) && Array.isArray(list.operations)) list = list.operations;
  if (!Array.isArray(list)) return { error: 'operations harus berupa array operasi' };
  if (list.length === 0) return { error: 'operations kosong' };
  if (list.length > LIMITS.MAX_OPERATIONS) {
    return { error: `Terlalu banyak operasi (${list.length}; maks ${LIMITS.MAX_OPERATIONS} per patch)` };
  }

  const ops = [];
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    const at = `Operasi #${i + 1}`;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { error: `${at}: harus berupa objek` };
    if (!OP_KINDS.includes(o.op)) return { error: `${at}: "op" harus salah satu dari ${OP_KINDS.join(', ')}` };
    const needStr = (k) => typeof o[k] === 'string' && o[k].trim() !== '';
    if (o.op === 'rename') {
      if (!needStr('from') || !needStr('to')) return { error: `${at}: rename butuh "from" dan "to"` };
      ops.push({ op: 'rename', from: o.from.trim(), to: o.to.trim() });
      continue;
    }
    if (!needStr('path')) return { error: `${at}: "path" wajib ada` };
    const p = o.path.trim();
    if (o.op === 'delete') {
      ops.push({ op: 'delete', path: p });
    } else if (o.op === 'create') {
      if (typeof o.content !== 'string') return { error: `${at}: create butuh "content" berupa teks` };
      ops.push({ op: 'create', path: p, content: o.content });
    } else {
      if (typeof o.oldText !== 'string' || o.oldText === '') return { error: `${at}: edit butuh "oldText" yang tidak kosong` };
      if (typeof o.newText !== 'string') return { error: `${at}: edit butuh "newText" (boleh kosong untuk menghapus)` };
      const all = o.replaceAll === true || String(o.replaceAll).toLowerCase() === 'true';
      ops.push({ op: 'edit', path: p, oldText: o.oldText, newText: o.newText, replaceAll: all });
    }
  }
  return { ops };
}

module.exports = { parseOperations };
