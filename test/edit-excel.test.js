const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-xl-'));
process.env.VIA_ALLOWED_DIRS = dir;
const editExcel = require('../src/tools/edit-excel');
const { planOperations } = editExcel.__test;

const ops = (...list) => JSON.stringify(list);

async function fixture(name, build) {
  const wb = new ExcelJS.Workbook();
  build(wb);
  const p = path.join(dir, name);
  await wb.xlsx.writeFile(p);
  return p;
}

async function load(p) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(p);
  return wb;
}

function withFormulas(wb) {
  const ws = wb.addWorksheet('Nilai');
  ws.addRow(['Nama', 'Nilai']);
  ws.addRow(['Budi', 85]);
  ws.addRow(['Sari', 90]);
  ws.addRow(['Total', { formula: 'SUM(B2:B3)', result: 175 }]);
  ws.getRow(1).font = { bold: true };
  ws.getColumn(1).width = 30;
  ws.getCell('B2').numFmt = '0.00';
}

test('planOperations menolak masukan yang salah bentuk', () => {
  const bad = [
    'bukan json',
    '[]',
    '{"op":"set_cell"}',
    ops({ op: 'hapus_semua' }),
    ops({ op: 'set_cell', cell: 'ZZZZ1', value: 1 }),
    ops({ op: 'set_cell', cell: 'A1', value: { a: 1 } }),
    ops({ op: 'set_range', start: 'A1', values: [] }),
    ops({ op: 'delete_rows', at: 0 }),
    ops({ op: 'add_sheet', name: 'a/b' }),
    ops({ op: 'rename_sheet', from: 'A', to: '' }),
  ];
  for (const raw of bad) assert.equal(planOperations(raw).ok, false, raw);
  assert.equal(planOperations(JSON.stringify(Array(51).fill({ op: 'set_cell', cell: 'A1', value: 1 }))).ok, false);
});

test('rumus berbahaya ditolak, rumus biasa diterima', () => {
  for (const f of ['=HYPERLINK("http://x","y")', '=WEBSERVICE("http://x")', "=cmd|' /C calc'!A0", "='[x.xlsx]S'!A1"]) {
    assert.equal(planOperations(ops({ op: 'set_cell', cell: 'A1', value: f })).ok, false, f);
  }
  assert.equal(planOperations(ops({ op: 'set_cell', cell: 'A1', value: '=SUM(B2:B9)' })).ok, true);
  assert.equal(planOperations(ops({ op: 'set_cell', cell: 'A1', value: '=Rekap!B2*2' })).ok, true);
});

test('batas jumlah sel per panggilan ditegakkan', () => {
  const big = Array.from({ length: 101 }, () => Array(50).fill(1));
  const r = planOperations(ops({ op: 'set_range', start: 'A1', values: big }));
  assert.equal(r.ok, false);
  assert.match(r.error, /Terlalu banyak sel/);
});

test('edit sel dan tambah baris: rumus, format, lebar kolom, dan file asli tetap utuh', async () => {
  const src = await fixture('a.xlsx', withFormulas);
  const r = await editExcel.execute({
    path: src,
    operations: ops(
      { op: 'set_cell', cell: 'B2', value: 95 },
      { op: 'append_rows', rows: [['Rani', 75]] },
      { op: 'set_cell', sheet: 'Nilai', cell: 'B6', value: '=AVERAGE(B2:B5)' },
    ),
  });
  assert.equal(r.success, true, r.error);
  assert.equal(r.mode, 'copy');
  assert.notEqual(r.path, src);
  assert.match(path.basename(r.path), /^a-edit\.xlsx$/);

  const out = (await load(r.path)).getWorksheet('Nilai');
  assert.equal(out.getCell('B2').value, 95);
  assert.equal(out.getCell('B2').numFmt, '0.00');
  assert.deepEqual(out.getCell('B4').value.formula, 'SUM(B2:B3)');
  assert.equal(out.getCell('A5').value, 'Rani');
  assert.equal(out.getCell('B6').value.formula, 'AVERAGE(B2:B5)');
  assert.equal(out.getRow(1).font.bold, true);
  assert.equal(out.getColumn(1).width, 30);

  const orig = (await load(src)).getWorksheet('Nilai');
  assert.equal(orig.getCell('B2').value, 85, 'file asli tidak boleh berubah');
});

test('operasi yang gagal membatalkan seluruh patch dan tidak menulis file', async () => {
  const src = await fixture('rollback.xlsx', withFormulas);
  const before = fs.readdirSync(dir).sort();
  const r = await editExcel.execute({
    path: src,
    operations: ops(
      { op: 'set_cell', cell: 'A1', value: 'X' },
      { op: 'set_cell', sheet: 'Tidak Ada', cell: 'A1', value: 'Y' },
    ),
  });
  assert.equal(r.success, false);
  assert.match(r.error, /Operasi #2/);
  assert.match(r.error, /Tidak ada yang ditulis/);
  assert.deepEqual(fs.readdirSync(dir).sort(), before);
});

test('insert/delete baris ditolak bila file berisi rumus', async () => {
  const src = await fixture('formula.xlsx', withFormulas);
  const r = await editExcel.execute({ path: src, operations: ops({ op: 'insert_rows', at: 2 }) });
  assert.equal(r.success, false);
  assert.match(r.error, /sel berumus/);
});

test('insert, set_range, dan delete baris pada file tanpa rumus', async () => {
  const src = await fixture('plain.xlsx', (wb) => {
    const ws = wb.addWorksheet('D');
    ['h', 'r1', 'r2', 'r3'].forEach((v) => ws.addRow([v]));
  });
  const r = await editExcel.execute({
    path: src,
    operations: ops(
      { op: 'insert_rows', at: 2, count: 2 },
      { op: 'set_range', start: 'A2', values: [['n1'], ['n2']] },
      { op: 'delete_rows', at: 6 },
    ),
  });
  assert.equal(r.success, true, r.error);
  const ws = (await load(r.path)).getWorksheet('D');
  const col = [];
  ws.eachRow((row) => col.push(row.getCell(1).value));
  assert.deepEqual(col, ['h', 'n1', 'n2', 'r1', 'r2']);
});

test('overwrite menimpa file asli dan membuat cadangan', async () => {
  const src = await fixture('over.xlsx', (wb) => wb.addWorksheet('D').addRow(['x', 1]));
  const r = await editExcel.execute({
    path: src,
    saveMode: 'overwrite',
    operations: ops({ op: 'rename_sheet', from: 'D', to: 'Data' }, { op: 'add_sheet', name: 'Rekap', rows: [['a', 1]] }),
  });
  assert.equal(r.success, true, r.error);
  assert.equal(r.path, src);
  assert.ok(r.backupPath && fs.existsSync(r.backupPath));
  assert.deepEqual((await load(src)).worksheets.map((w) => w.name), ['Data', 'Rekap']);
  assert.deepEqual((await load(r.backupPath)).worksheets.map((w) => w.name), ['D']);
});

test('tidak bisa menghapus satu-satunya sheet dan nama sheet kembar ditolak', async () => {
  const src = await fixture('sheets.xlsx', (wb) => wb.addWorksheet('Satu').addRow([1]));
  let r = await editExcel.execute({ path: src, operations: ops({ op: 'delete_sheet', name: 'Satu' }) });
  assert.equal(r.success, false);
  assert.match(r.error, /satu-satunya sheet/);
  r = await editExcel.execute({ path: src, operations: ops({ op: 'add_sheet', name: 'satu' }) });
  assert.equal(r.success, false);
  assert.match(r.error, /sudah ada/);
});

test('menolak path di luar area, ekstensi salah, dan saveMode tidak valid', async () => {
  let r = await editExcel.execute({ path: path.join(os.tmpdir(), 'luar-area-via.xlsx'), operations: ops({ op: 'set_cell', cell: 'A1', value: 1 }) });
  assert.equal(r.success, false);
  assert.match(r.error, /di luar area/);
  r = await editExcel.execute({ path: path.join(dir, 'x.csv'), operations: ops({ op: 'set_cell', cell: 'A1', value: 1 }) });
  assert.match(r.error, /\.xlsx/);
  assert.match(editExcel.validate({ operations: ops({ op: 'set_cell', cell: 'A1', value: 1 }), saveMode: 'hapus' }), /saveMode/);
});

test('describe memberi peringatan untuk operasi merusak dan menyebut mode simpan', () => {
  const text = editExcel.describe({
    path: path.join(dir, 'a.xlsx'),
    operations: ops({ op: 'delete_rows', at: 2, count: 3 }, { op: 'set_cell', cell: 'A1', value: 1 }),
    saveMode: 'overwrite',
  });
  assert.match(text, /PERHATIAN/);
  assert.match(text, /menghapus 3 baris/);
  assert.match(text, /MENIMPA/);
  assert.equal(editExcel.alwaysConfirm, true);
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
