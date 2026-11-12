const { MAX_OPERATIONS, MAX_CELLS, MAX_ROW, MAX_COL, MAX_ROW_COUNT, MAX_SHEET_NAME, SHEET_BAD_CHARS, OP_NAMES } = require('./limits');
const { parseAddress, parseRange } = require('./address');
const { checkValue } = require('./values');

function checkMatrix(rows, label) {
  if (!Array.isArray(rows) || !rows.length || !rows.every(Array.isArray)) {
    return { error: `${label} harus array of array yang tidak kosong` };
  }
  let cells = 0;
  for (const r of rows) {
    if (r.length > 50) return { error: `${label}: terlalu banyak kolom (maks 50)` };
    for (const v of r) {
      const e = checkValue(v);
      if (e) return { error: `${label}: ${e}` };
    }
    cells += r.length;
  }
  return { cells };
}

function checkSheetName(name, label) {
  const s = typeof name === 'string' ? name.trim() : '';
  if (!s) return `${label} wajib diisi`;
  if (s.length > MAX_SHEET_NAME) return `${label} terlalu panjang (maks ${MAX_SHEET_NAME} karakter)`;
  if (SHEET_BAD_CHARS.test(s)) return `${label} memuat karakter terlarang (\\ / ? * [ ] :)`;
  return null;
}

function posInt(v, def, max) {
  const n = v === undefined ? def : v;
  return Number.isInteger(n) && n >= 1 && n <= max ? n : null;
}

function checkOp(raw, i) {
  const at = `Operasi #${i + 1}`;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: `${at}: harus berupa objek` };
  if (!OP_NAMES.includes(raw.op)) {
    return { error: `${at}: op \"${String(raw.op)}\" tidak dikenal. Pilihan: ${OP_NAMES.join(', ')}` };
  }
  const op = { op: raw.op };
  const tag = `${at} (${raw.op})`;
  if (raw.sheet !== undefined) {
    if (typeof raw.sheet !== 'string' || !raw.sheet.trim()) return { error: `${tag}: \"sheet\" harus teks nama sheet` };
    op.sheet = raw.sheet.trim();
  }

  switch (raw.op) {
    case 'set_cell': {
      if (!parseAddress(raw.cell)) return { error: `${tag}: \"cell\" harus alamat sel seperti B2` };
      const e = checkValue(raw.value);
      if (e) return { error: `${tag}: ${e}` };
      return { op: { ...op, cell: String(raw.cell).trim(), value: raw.value === undefined ? null : raw.value }, cells: 1 };
    }
    case 'set_range': {
      const a = parseAddress(raw.start);
      if (!a) return { error: `${tag}: \"start\" harus alamat sel seperti A5` };
      const m = checkMatrix(raw.values, `${tag}: \"values\"`);
      if (m.error) return { error: m.error };
      const widest = raw.values.reduce((x, r) => Math.max(x, r.length), 0);
      if (a.col + widest - 1 > MAX_COL || a.row + raw.values.length - 1 > MAX_ROW) {
        return { error: `${tag}: data melewati batas lembar kerja` };
      }
      return { op: { ...op, start: String(raw.start).trim(), values: raw.values }, cells: m.cells };
    }
    case 'append_rows': {
      const m = checkMatrix(raw.rows, `${tag}: \"rows\"`);
      if (m.error) return { error: m.error };
      return { op: { ...op, rows: raw.rows }, cells: m.cells, rowsAdded: raw.rows.length };
    }
    case 'insert_rows':
    case 'delete_rows': {
      const at1 = posInt(raw.at, undefined, MAX_ROW);
      const count = posInt(raw.count, 1, MAX_ROW_COUNT);
      if (!at1) return { error: `${tag}: \"at\" harus nomor baris (bilangan bulat >= 1)` };
      if (!count) return { error: `${tag}: \"count\" harus bilangan bulat 1-${MAX_ROW_COUNT}` };
      return { op: { ...op, at: at1, count }, rowCount: count };
    }
    case 'clear_range': {
      const r = parseRange(raw.range);
      if (!r) return { error: `${tag}: \"range\" harus rentang seperti A2:C10` };
      const cells = (r.c2 - r.c1 + 1) * (r.r2 - r.r1 + 1);
      return { op: { ...op, range: String(raw.range).trim() }, cells };
    }
    case 'add_sheet': {
      const e = checkSheetName(raw.name, '\"name\"');
      if (e) return { error: `${tag}: ${e}` };
      let cells = 0;
      let rows;
      if (raw.rows !== undefined) {
        const m = checkMatrix(raw.rows, `${tag}: \"rows\"`);
        if (m.error) return { error: m.error };
        cells = m.cells;
        rows = raw.rows;
      }
      return { op: { ...op, name: raw.name.trim(), ...(rows ? { rows } : {}) }, cells };
    }
    case 'rename_sheet': {
      const e = checkSheetName(raw.from, '\"from\"') || checkSheetName(raw.to, '\"to\"');
      if (e) return { error: `${tag}: ${e}` };
      return { op: { ...op, from: raw.from.trim(), to: raw.to.trim() } };
    }
    case 'delete_sheet': {
      const e = checkSheetName(raw.name, '\"name\"');
      if (e) return { error: `${tag}: ${e}` };
      return { op: { ...op, name: raw.name.trim() } };
    }
    default:
      return { error: `${at}: op tidak dikenal` };
  }
}

function planOperations(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Argumen \"operations\" bukan JSON yang valid. Kirim array operasi, mis. [{\"op\":\"set_cell\",\"cell\":\"B2\",\"value\":90}]' };
  }
  if (!Array.isArray(data) || !data.length) return { ok: false, error: 'Argumen \"operations\" harus array yang tidak kosong' };
  if (data.length > MAX_OPERATIONS) return { ok: false, error: `Terlalu banyak operasi (maks ${MAX_OPERATIONS} per panggilan)` };

  const ops = [];
  const s = {
    cellsWritten: 0, cellsCleared: 0, rowsAppended: 0, rowsInserted: 0, rowsDeleted: 0,
    sheetsAdded: 0, sheetsRenamed: 0, sheetsRemoved: 0,
  };
  const destructive = [];
  let structural = false;
  let cells = 0;

  for (let i = 0; i < data.length; i++) {
    const r = checkOp(data[i], i);
    if (r.error) return { ok: false, error: r.error };
    ops.push(r.op);
    cells += r.cells || 0;
    switch (r.op.op) {
      case 'set_cell': case 'set_range': s.cellsWritten += r.cells; break;
      case 'append_rows': s.rowsAppended += r.rowsAdded; s.cellsWritten += r.cells; break;
      case 'insert_rows': s.rowsInserted += r.rowCount; structural = true; break;
      case 'delete_rows':
        s.rowsDeleted += r.rowCount; structural = true;
        destructive.push(`menghapus ${r.rowCount} baris`);
        break;
      case 'clear_range':
        s.cellsCleared += r.cells;
        destructive.push(`mengosongkan ${r.cells} sel`);
        break;
      case 'add_sheet': s.sheetsAdded += 1; s.cellsWritten += r.cells || 0; break;
      case 'rename_sheet': s.sheetsRenamed += 1; break;
      case 'delete_sheet': s.sheetsRemoved += 1; destructive.push(`menghapus sheet \"${r.op.name}\"`); break;
      default: break;
    }
  }
  if (cells > MAX_CELLS) return { ok: false, error: `Terlalu banyak sel (${cells}); maks ${MAX_CELLS} per panggilan. Pecah jadi beberapa panggilan.` };
  return { ok: true, ops, summary: s, destructive, structural };
}

function summarize(s) {
  const parts = [];
  if (s.cellsWritten) parts.push(`menulis ${s.cellsWritten} sel`);
  if (s.rowsAppended) parts.push(`menambah ${s.rowsAppended} baris di akhir`);
  if (s.rowsInserted) parts.push(`menyisipkan ${s.rowsInserted} baris`);
  if (s.rowsDeleted) parts.push(`menghapus ${s.rowsDeleted} baris`);
  if (s.cellsCleared) parts.push(`mengosongkan ${s.cellsCleared} sel`);
  if (s.sheetsAdded) parts.push(`menambah ${s.sheetsAdded} sheet`);
  if (s.sheetsRenamed) parts.push(`mengganti nama ${s.sheetsRenamed} sheet`);
  if (s.sheetsRemoved) parts.push(`menghapus ${s.sheetsRemoved} sheet`);
  return parts.join(', ') || 'mengubah isi';
}

module.exports = { checkOp, planOperations, summarize };
