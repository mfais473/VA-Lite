const core = require('../docx-core');

const MAX_OPERATIONS = 50;
const MAX_TEXT = 20000;
const MAX_FIND = 1000;
const MAX_TOTAL_CHARS = 100000;
const MAX_CELLS_PER_ROW = 30;

const OP_NAMES = [
  'replace_text', 'set_paragraph', 'insert_paragraph', 'append_paragraph',
  'delete_block', 'set_table_cell', 'append_table_row', 'delete_table_row',
];

function asInt(v) {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'string' && /^\d{1,7}$/.test(v.trim())) return parseInt(v.trim(), 10);
  return null;
}

function cellValue(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

function checkOp(raw, i) {
  const at = `Operasi #${i + 1}`;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: `${at}: harus berupa objek` };
  if (!OP_NAMES.includes(raw.op)) return { error: `${at}: op \"${String(raw.op)}\" tidak dikenal. Pilihan: ${OP_NAMES.join(', ')}` };
  const tag = `${at} (${raw.op})`;
  const op = { op: raw.op };
  let chars = 0;

  const needBlock = (key = 'block', min = 1) => {
    const n = asInt(raw[key]);
    if (n === null || n < min) throw new Error(`${tag}: \"${key}\" harus nomor blok (bilangan bulat >= ${min}), sesuai nomor [n] dari read_word`);
    return n;
  };
  const needText = (key, { allowEmpty = false, max = MAX_TEXT } = {}) => {
    const v = raw[key];
    if (typeof v !== 'string') throw new Error(`${tag}: \"${key}\" wajib berupa teks`);
    if (!allowEmpty && !v.trim()) throw new Error(`${tag}: \"${key}\" tidak boleh kosong`);
    if (v.length > max) throw new Error(`${tag}: \"${key}\" terlalu panjang (maks ${max} karakter)`);
    chars += v.length;
    return core.sanitizeText(v);
  };
  const styleKey = () => {
    if (raw.style === undefined) return undefined;
    const k = String(raw.style).toLowerCase();
    if (!(k in core.STYLE_MAP)) throw new Error(`${tag}: style \"${raw.style}\" tidak dikenal. Pilihan: ${Object.keys(core.STYLE_MAP).join(', ')}`);
    return k;
  };

  try {
    switch (raw.op) {
      case 'replace_text': {
        const find = needText('find', { max: MAX_FIND });
        if (find.includes('\n')) throw new Error(`${tag}: \"find\" tidak boleh memuat baris baru; cari satu baris saja`);
        const replace = needText('replace', { allowEmpty: true, max: MAX_TEXT });
        if (replace.includes('\n')) throw new Error(`${tag}: \"replace\" tidak boleh memuat baris baru; pakai insert_paragraph untuk paragraf baru`);
        Object.assign(op, { find, replace, replaceAll: raw.replaceAll === true, matchCase: raw.matchCase !== false });
        if (raw.block !== undefined) op.block = needBlock();
        break;
      }
      case 'set_paragraph':
        Object.assign(op, { block: needBlock(), text: needText('text', { allowEmpty: true }) });
        break;
      case 'insert_paragraph': {
        const after = asInt(raw.after);
        if (after === null || after < 0) throw new Error(`${tag}: \"after\" harus nomor blok (0 = di awal dokumen)`);
        Object.assign(op, { after, text: needText('text') });
        const s = styleKey();
        if (s) op.style = s;
        break;
      }
      case 'append_paragraph': {
        op.text = needText('text');
        const s = styleKey();
        if (s) op.style = s;
        break;
      }
      case 'delete_block':
        op.block = needBlock();
        break;
      case 'set_table_cell': {
        const row = asInt(raw.row);
        const col = asInt(raw.col);
        if (row === null || row < 1 || col === null || col < 1) throw new Error(`${tag}: \"row\" dan \"col\" harus bilangan bulat >= 1`);
        Object.assign(op, { block: needBlock(), row, col, text: needText('text', { allowEmpty: true }) });
        break;
      }
      case 'append_table_row': {
        if (!Array.isArray(raw.cells) || !raw.cells.length) throw new Error(`${tag}: \"cells\" harus array nilai yang tidak kosong`);
        if (raw.cells.length > MAX_CELLS_PER_ROW) throw new Error(`${tag}: terlalu banyak sel (maks ${MAX_CELLS_PER_ROW})`);
        const cells = raw.cells.map((c) => {
          const s = cellValue(c);
          if (s === null) throw new Error(`${tag}: nilai sel harus teks/angka/boolean`);
          if (s.length > MAX_TEXT) throw new Error(`${tag}: teks sel terlalu panjang`);
          chars += s.length;
          return core.sanitizeText(s);
        });
        Object.assign(op, { block: needBlock(), cells });
        break;
      }
      case 'delete_table_row': {
        const row = asInt(raw.row);
        if (row === null || row < 1) throw new Error(`${tag}: \"row\" harus bilangan bulat >= 1`);
        Object.assign(op, { block: needBlock(), row });
        break;
      }
      default:
        throw new Error(`${at}: op tidak dikenal`);
    }
  } catch (err) {
    return { error: err.message };
  }
  return { op, chars };
}

function planOperations(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Argumen \"operations\" bukan JSON yang valid. Kirim array operasi, mis. [{\"op\":\"replace_text\",\"find\":\"lama\",\"replace\":\"baru\"}]' };
  }
  if (!Array.isArray(data) || !data.length) return { ok: false, error: 'Argumen \"operations\" harus array yang tidak kosong' };
  if (data.length > MAX_OPERATIONS) return { ok: false, error: `Terlalu banyak operasi (maks ${MAX_OPERATIONS} per panggilan)` };

  const ops = [];
  let total = 0;
  const s = { replace: 0, setParagraph: 0, insert: 0, deleteBlock: 0, setCell: 0, addRow: 0, deleteRow: 0 };
  const destructive = [];
  for (let i = 0; i < data.length; i++) {
    const r = checkOp(data[i], i);
    if (r.error) return { ok: false, error: r.error };
    ops.push(r.op);
    total += r.chars || 0;
    switch (r.op.op) {
      case 'replace_text': s.replace += 1; break;
      case 'set_paragraph': s.setParagraph += 1; break;
      case 'insert_paragraph': case 'append_paragraph': s.insert += 1; break;
      case 'delete_block': s.deleteBlock += 1; destructive.push(`menghapus blok ${r.op.block}`); break;
      case 'set_table_cell': s.setCell += 1; break;
      case 'append_table_row': s.addRow += 1; break;
      case 'delete_table_row': s.deleteRow += 1; destructive.push(`menghapus baris ${r.op.row} tabel di blok ${r.op.block}`); break;
      default: break;
    }
  }
  if (total > MAX_TOTAL_CHARS) return { ok: false, error: `Teks terlalu banyak (maks ${MAX_TOTAL_CHARS} karakter per panggilan). Pecah jadi beberapa panggilan.` };
  return { ok: true, ops, summary: s, destructive };
}

function summarizePlan(s) {
  const parts = [];
  if (s.replace) parts.push(`mengganti teks (${s.replace} operasi)`);
  if (s.setParagraph) parts.push(`menulis ulang ${s.setParagraph} paragraf`);
  if (s.insert) parts.push(`menambah ${s.insert} paragraf`);
  if (s.deleteBlock) parts.push(`menghapus ${s.deleteBlock} blok`);
  if (s.setCell) parts.push(`mengubah ${s.setCell} sel tabel`);
  if (s.addRow) parts.push(`menambah ${s.addRow} baris tabel`);
  if (s.deleteRow) parts.push(`menghapus ${s.deleteRow} baris tabel`);
  return parts.join(', ') || 'mengubah isi';
}

module.exports = { MAX_OPERATIONS, planOperations, summarizePlan };
