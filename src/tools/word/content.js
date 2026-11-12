const core = require('../docx-core');

const MAX_BLOCKS = 500;
const MAX_ITEMS = 200;
const MAX_TABLE_ROWS = 500;
const MAX_TABLE_COLS = 20;
const MAX_TEXT = 20000;
const MAX_TOTAL_CHARS = 200000;
const BLOCK_TYPES = ['title', 'heading', 'paragraph', 'bullets', 'numbered', 'table', 'page_break'];

function cellString(v) {
  if (v === null || v === undefined) return '';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

function parseContent(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { error: 'Argumen \"content\" bukan JSON yang valid. Kirim array blok, mis. [{\"type\":\"heading\",\"level\":1,\"text\":\"Judul\"},{\"type\":\"paragraph\",\"text\":\"Isi\"}]' };
  }
  if (!Array.isArray(data) || !data.length) return { error: 'Argumen \"content\" harus array blok yang tidak kosong' };
  if (data.length > MAX_BLOCKS) return { error: `Terlalu banyak blok (maks ${MAX_BLOCKS})` };

  const blocks = [];
  let chars = 0;
  const text = (v, tag) => {
    if (typeof v !== 'string' || !v.trim()) throw new Error(`${tag}: \"text\" wajib berupa teks tidak kosong`);
    if (v.length > MAX_TEXT) throw new Error(`${tag}: teks terlalu panjang (maks ${MAX_TEXT} karakter)`);
    chars += v.length;
    return core.sanitizeText(v);
  };

  try {
    data.forEach((b, i) => {
      const tag = `Blok #${i + 1}`;
      if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Error(`${tag}: harus berupa objek`);
      if (!BLOCK_TYPES.includes(b.type)) throw new Error(`${tag}: type \"${String(b.type)}\" tidak dikenal. Pilihan: ${BLOCK_TYPES.join(', ')}`);
      switch (b.type) {
        case 'title':
        case 'paragraph':
          blocks.push({ type: b.type, text: text(b.text, tag) });
          break;
        case 'heading': {
          const level = b.level === undefined ? 1 : b.level;
          if (!Number.isInteger(level) || level < 1 || level > 6) throw new Error(`${tag}: \"level\" harus 1-6`);
          blocks.push({ type: 'heading', level, text: text(b.text, tag) });
          break;
        }
        case 'bullets':
        case 'numbered': {
          if (!Array.isArray(b.items) || !b.items.length) throw new Error(`${tag}: \"items\" harus array teks yang tidak kosong`);
          if (b.items.length > MAX_ITEMS) throw new Error(`${tag}: terlalu banyak butir (maks ${MAX_ITEMS})`);
          blocks.push({ type: b.type, items: b.items.map((it) => text(it, tag)) });
          break;
        }
        case 'table': {
          if (!Array.isArray(b.rows) || !b.rows.length || !b.rows.every(Array.isArray)) {
            throw new Error(`${tag}: \"rows\" harus array of array (baris pertama = header)`);
          }
          if (b.rows.length > MAX_TABLE_ROWS) throw new Error(`${tag}: terlalu banyak baris tabel (maks ${MAX_TABLE_ROWS})`);
          if (b.rows.some((r) => r.length > MAX_TABLE_COLS)) throw new Error(`${tag}: terlalu banyak kolom tabel (maks ${MAX_TABLE_COLS})`);
          const rows = b.rows.map((r) => r.map((c) => {
            const s = cellString(c);
            if (s.length > MAX_TEXT) throw new Error(`${tag}: teks sel terlalu panjang`);
            chars += s.length;
            return core.sanitizeText(s);
          }));
          if (!rows.some((r) => r.length)) throw new Error(`${tag}: tabel tidak punya sel`);
          blocks.push({ type: 'table', rows, header: b.header !== false });
          break;
        }
        case 'page_break':
          blocks.push({ type: 'page_break' });
          break;
        default:
          throw new Error(`${tag}: type tidak dikenal`);
      }
    });
  } catch (err) {
    return { error: err.message };
  }
  if (chars > MAX_TOTAL_CHARS) return { error: `Isi terlalu panjang (maks ${MAX_TOTAL_CHARS} karakter per dokumen)` };
  return { blocks, chars };
}

module.exports = { MAX_BLOCKS, parseContent };
