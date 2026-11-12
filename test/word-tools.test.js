const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-wd-'));
process.env.VIA_ALLOWED_DIRS = dir;
const createWord = require('../src/tools/create-word');
const readWord = require('../src/tools/read-word');
const editWord = require('../src/tools/edit-word');
const core = require('../src/tools/docx-core');
const artifacts = require('../src/tools/session-artifacts');

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const ops = (...list) => JSON.stringify(list);

async function miniDocx(name, bodyXml, { styles } = {}) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>');
  zip.file('_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>');
  zip.file('word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${bodyXml}<w:sectPr/></w:body></w:document>`);
  if (styles) {
    zip.file('word/styles.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}">` +
      styles.map((id) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${id}"/></w:style>`).join('') +
      '</w:styles>');
  }
  const p = path.join(dir, name);
  fs.writeFileSync(p, await zip.generateAsync({ type: 'nodebuffer' }));
  return p;
}

const run = (t, props = '') => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${t}</w:t></w:r>`;
const para = (...runs) => `<w:p>${runs.join('')}</w:p>`;

async function textOf(p) {
  const r = await readWord.execute({ path: p, maxBlocks: '200' });
  assert.equal(r.success, true, r.error);
  return r.text;
}

async function documentXml(p) {
  return (await JSZip.loadAsync(fs.readFileSync(p))).file('word/document.xml').async('string');
}

test('parseContent menolak blok yang salah bentuk', () => {
  const { parseContent } = createWord.__test;
  const bad = [
    'bukan json', '[]', ops({ type: 'gambar' }), ops({ type: 'heading', level: 9, text: 'x' }),
    ops({ type: 'paragraph', text: '   ' }), ops({ type: 'bullets', items: [] }),
    ops({ type: 'table', rows: ['a'] }), ops({ type: 'table', rows: [Array(21).fill('x')] }),
  ];
  for (const raw of bad) assert.ok(parseContent(raw).error, raw);
  assert.ok(!parseContent(ops({ type: 'heading', text: 'ok' })).error);
});

const SAMPLE = [
  { type: 'title', text: 'Laporan Praktikum' },
  { type: 'heading', level: 1, text: 'Pendahuluan' },
  { type: 'paragraph', text: 'Sampel diuji di **Jember** pada tahun 2026. Jember adalah lokasi uji.' },
  { type: 'bullets', items: ['satu', 'dua'] },
  { type: 'numbered', items: ['langkah A', 'langkah B'] },
  { type: 'table', rows: [['Nama', 'Nilai'], ['Budi', 85], ['Sari', 90]] },
  { type: 'heading', level: 1, text: 'Penutup' },
  { type: 'paragraph', text: 'Selesai.' },
];

async function makeSample(name = 'laporan.docx') {
  const r = await createWord.execute({ fileName: name, folder: dir, content: JSON.stringify(SAMPLE) });
  assert.equal(r.success, true, r.error);
  return r;
}

test('create_word membuat .docx yang bisa dibaca ulang read_word dengan nomor blok', async () => {
  const r = await makeSample();
  assert.equal(r.blocks, 10);
  assert.equal(r.tables, 1);
  assert.deepEqual(r.headings.map((h) => [h.n, h.level, h.text]), [[1, 0, 'Laporan Praktikum'], [2, 1, 'Pendahuluan'], [9, 1, 'Penutup']]);

  const text = await textOf(r.path);
  assert.match(text, /^\[1\] \(Judul\) Laporan Praktikum/m);
  assert.match(text, /^\[2\] \(H1\) Pendahuluan/m);
  assert.match(text, /^\[3\] Sampel diuji di Jember pada tahun 2026/m);
  assert.match(text, /^\[4\] \(daftar\) satu/m);
  assert.match(text, /^\[8\] \(TABEL 3x2\) \[\["Nama","Nilai"\],\["Budi","85"\],\["Sari","90"\]\]/m);
});

test('create_word tidak menimpa file yang sudah ada dan menambah ekstensi', async () => {
  const a = await createWord.execute({ fileName: 'sama', folder: dir, content: ops({ type: 'paragraph', text: 'a' }) });
  const b = await createWord.execute({ fileName: 'sama', folder: dir, content: ops({ type: 'paragraph', text: 'b' }) });
  assert.equal(path.basename(a.path), 'sama.docx');
  assert.equal(path.basename(b.path), 'sama-1.docx');
});

test('create_word menolak folder di luar area yang diizinkan', async () => {
  const r = await createWord.execute({ fileName: 'x.docx', folder: path.join(os.tmpdir(), 'luar-via'), content: ops({ type: 'paragraph', text: 'a' }) });
  assert.equal(r.success, false);
  assert.match(r.error, /di luar area/);
});

test('karakter XML khusus dan karakter kontrol aman melewati create -> read -> edit', async () => {
  const r = await createWord.execute({ fileName: 'xml.docx', folder: dir, content: ops({ type: 'paragraph', text: 'A & B <tag> "q" \u0007akhir' }) });
  assert.equal(r.success, true, r.error);
  assert.match(await textOf(r.path), /A & B <tag> "q" akhir/);
  const e = await editWord.execute({ path: r.path, operations: ops({ op: 'replace_text', find: '<tag>', replace: '<x & y>' }) });
  assert.equal(e.success, true, e.error);
  assert.match(await textOf(e.path), /A & B <x & y> "q" akhir/);
});

test('read_word membaca per halaman dan menandai data belum lengkap', async () => {
  const content = Array.from({ length: 30 }, (_, i) => ({ type: 'paragraph', text: `Paragraf ${i + 1}` }));
  const made = await createWord.execute({ fileName: 'panjang.docx', folder: dir, content: JSON.stringify(content) });
  let r = await readWord.execute({ path: made.path, startBlock: '1', maxBlocks: '10' });
  assert.equal(r.returnedBlocks, 10);
  assert.equal(r.nextStartBlock, 11);
  assert.equal(r.complete, false);
  assert.match(r.note, /BELUM lengkap/);
  r = await readWord.execute({ path: made.path, startBlock: '11', maxBlocks: '200' });
  assert.equal(r.nextStartBlock, null);
  assert.equal(r.complete, false, 'dibaca mulai di tengah tidak dianggap lengkap');
  r = await readWord.execute({ path: made.path });
  assert.equal(r.complete, true);
});

test('read_word memotong paragraf panjang dan menandainya belum lengkap', async () => {
  const made = await createWord.execute({ fileName: 'tebal.docx', folder: dir, content: ops({ type: 'paragraph', text: 'x'.repeat(2000) }) });
  const r = await readWord.execute({ path: made.path });
  assert.equal(r.complete, false);
  assert.ok(r.text.length < 900);
});

test('read_word menolak .doc, ekstensi lain, file bukan docx, dan path di luar area', async () => {
  assert.match((await readWord.execute({ path: path.join(dir, 'a.doc') })).error, /\.doc lama/);
  assert.match((await readWord.execute({ path: path.join(dir, 'a.txt') })).error, /\.docx/);
  assert.match((await readWord.execute({ path: path.join(os.tmpdir(), 'luar-via.docx') })).error, /di luar area/);
  const fake = path.join(dir, 'palsu.docx');
  fs.writeFileSync(fake, 'bukan zip');
  assert.match((await readWord.execute({ path: fake })).error, /bukan arsip ZIP|\.docx yang valid/);
});

test('read_word menandai gambar dan melewati teks di kotak teks', async () => {
  const p = await miniDocx('fitur.docx',
    para(run('Sebelum'), '<w:r><w:drawing/></w:r>') +
    para(run('Ada kotak'), '<w:r><w:pict><w:txbxContent><w:p><w:r><w:t>TEKS DALAM KOTAK</w:t></w:r></w:p></w:txbxContent></w:pict></w:r>'));
  const text = await textOf(p);
  assert.match(text, /\[1\] \(gambar\) Sebelum/);
  assert.doesNotMatch(text, /TEKS DALAM KOTAK/);
});

test('edit_word: penggantian teks, sisipan, sel tabel, dan hasil bisa dibaca ulang', async () => {
  const src = (await makeSample('edit.docx')).path;
  const r = await editWord.execute({
    path: src,
    operations: ops(
      { op: 'replace_text', find: 'Jember', replace: 'Surabaya', replaceAll: true },
      { op: 'set_paragraph', block: 10, text: 'Selesai dengan baik.' },
      { op: 'insert_paragraph', after: 2, text: 'Latar Belakang', style: 'heading2' },
      { op: 'insert_paragraph', after: 2, text: 'Paragraf sisipan.' },
      { op: 'set_table_cell', block: 8, row: 2, col: 2, text: '95' },
      { op: 'append_table_row', block: 8, cells: ['Rani', 75] },
      { op: 'delete_table_row', block: 8, row: 3 },
      { op: 'append_paragraph', text: 'Lampiran' },
    ),
  });
  assert.equal(r.success, true, r.error);
  assert.equal(r.mode, 'copy');
  assert.equal(path.basename(r.path), 'edit-edit.docx');
  assert.equal(r.changes.replaced, 2);

  const text = await textOf(r.path);
  assert.match(text, /\[3\] \(H2\) Latar Belakang\n\[4\] Paragraf sisipan\./, 'sisipan ke jangkar yang sama harus berurutan');
  assert.match(text, /Sampel diuji di Surabaya pada tahun 2026\. Surabaya adalah/);
  assert.match(text, /\[\["Nama","Nilai"\],\["Budi","95"\],\["Rani","75"\]\]/);
  assert.match(text, /\(H1\) Penutup\n\[\d+\] Selesai dengan baik\.\n\[\d+\] Lampiran/);

  assert.doesNotMatch(await textOf(src), /Surabaya/, 'file asli tidak berubah');
});

test('replace_text menemukan teks yang terpecah di beberapa run dan mempertahankan format', async () => {
  const p = await miniDocx('run.docx', para(run('Univer', '<w:b/>'), run('sitas Jem'), run('ber', '<w:i/>'), run(' dan lainnya')));
  const r = await editWord.execute({ path: p, operations: ops({ op: 'replace_text', find: 'Universitas Jember', replace: 'UNEJ' }) });
  assert.equal(r.success, true, r.error);
  assert.equal(await textOf(r.path), '[1] UNEJ dan lainnya');
  const xml = await documentXml(r.path);
  assert.match(xml, /<w:b\/>/, 'format run pertama tetap ada');
  assert.equal((await readWord.execute({ path: r.path })).totalBlocks, 1);
});

test('replace_text: tidak ditemukan, ambigu, dan matchCase', async () => {
  const p = await miniDocx('uniq.docx', para(run('kucing Kucing kucing')));
  let r = await editWord.execute({ path: p, operations: ops({ op: 'replace_text', find: 'anjing', replace: 'x' }) });
  assert.equal(r.success, false);
  assert.match(r.error, /tidak ditemukan/);
  r = await editWord.execute({ path: p, operations: ops({ op: 'replace_text', find: 'kucing', replace: 'x' }) });
  assert.equal(r.success, false);
  assert.match(r.error, /ditemukan 2 kali/);
  r = await editWord.execute({ path: p, operations: ops({ op: 'replace_text', find: 'kucing', replace: 'x', matchCase: false, replaceAll: true }) });
  assert.equal(r.success, true, r.error);
  assert.equal(await textOf(r.path), '[1] x x x');
});

test('patch gagal di tengah membatalkan semuanya dan tidak menulis file', async () => {
  const p = await miniDocx('batal.docx', para(run('satu')) + para(run('dua')));
  const before = fs.readdirSync(dir).sort();
  const r = await editWord.execute({
    path: p,
    operations: ops({ op: 'set_paragraph', block: 1, text: 'diubah' }, { op: 'set_paragraph', block: 9, text: 'tidak ada' }),
  });
  assert.equal(r.success, false);
  assert.match(r.error, /Operasi #2/);
  assert.match(r.error, /Tidak ada yang ditulis/);
  assert.deepEqual(fs.readdirSync(dir).sort(), before);
});

test('nomor blok merujuk dokumen sebelum patch, dan blok terhapus tidak bisa dirujuk lagi', async () => {
  const p = await miniDocx('nomor.docx', para(run('A')) + para(run('B')) + para(run('C')) + para(run('D')));
  let r = await editWord.execute({
    path: p,
    operations: ops({ op: 'delete_block', block: 2 }, { op: 'set_paragraph', block: 4, text: 'D2' }, { op: 'insert_paragraph', after: 0, text: 'Awal' }),
  });
  assert.equal(r.success, true, r.error);
  assert.equal(await textOf(r.path), '[1] Awal\n[2] A\n[3] C\n[4] D2');
  r = await editWord.execute({ path: p, operations: ops({ op: 'delete_block', block: 2 }, { op: 'set_paragraph', block: 2, text: 'x' }) });
  assert.equal(r.success, false);
  assert.match(r.error, /sudah dihapus/);
});

test('set_paragraph menolak paragraf berisi gambar atau field, dan paragraf tabel', async () => {
  const p = await miniDocx('kompleks.docx',
    para(run('Teks'), '<w:r><w:drawing/></w:r>') +
    para('<w:r><w:fldChar w:fldCharType="begin"/></w:r>', run('1'), '<w:r><w:fldChar w:fldCharType="end"/></w:r>') +
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>sel</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' + para());
  let r = await editWord.execute({ path: p, operations: ops({ op: 'set_paragraph', block: 1, text: 'x' }) });
  assert.match(r.error, /gambar/);
  r = await editWord.execute({ path: p, operations: ops({ op: 'set_paragraph', block: 2, text: 'x' }) });
  assert.match(r.error, /field/);
  r = await editWord.execute({ path: p, operations: ops({ op: 'set_paragraph', block: 3, text: 'x' }) });
  assert.match(r.error, /adalah tabel/);
  r = await editWord.execute({ path: p, operations: ops({ op: 'replace_text', find: 'Teks', replace: 'Isi' }) });
  assert.equal(r.success, true, 'replace_text tetap boleh pada paragraf bergambar');
  assert.match(await documentXml(r.path), /<w:drawing\/>/);
});

test('delete_block menolak membuat dokumen berakhir dengan tabel dan menolak hapus satu-satunya baris tabel', async () => {
  const p = await miniDocx('tabel.docx',
    para(run('Intro')) + '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' + para(run('Akhir')));
  let r = await editWord.execute({ path: p, operations: ops({ op: 'delete_block', block: 3 }) });
  assert.equal(r.success, false);
  assert.match(r.error, /berakhir dengan tabel/);
  r = await editWord.execute({ path: p, operations: ops({ op: 'delete_table_row', block: 2, row: 1 }) });
  assert.equal(r.success, false);
  assert.match(r.error, /satu-satunya baris/);
});

test('append_table_row tidak menyalin penanda header berulang', async () => {
  const p = await miniDocx('hdr.docx',
    '<w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p><w:r><w:t>H</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' + para());
  const r = await editWord.execute({ path: p, operations: ops({ op: 'append_table_row', block: 1, cells: ['baru'] }) });
  assert.equal(r.success, true, r.error);
  const xml = await documentXml(r.path);
  assert.equal((xml.match(/<w:tblHeader\/>/g) || []).length, 1);
  assert.match(await textOf(r.path), /\[\["H"\],\["baru"\]\]/);
});

test('gaya heading yang tidak ada di dokumen memicu peringatan dan jatuh ke gaya normal', async () => {
  const p = await miniDocx('nostyle.docx', para(run('A')));
  const r = await editWord.execute({ path: p, operations: ops({ op: 'insert_paragraph', after: 1, text: 'Bab', style: 'heading1' }) });
  assert.equal(r.success, true, r.error);
  assert.ok(r.warnings.some((w) => /Heading1 tidak ada/.test(w)));
  const withStyle = await miniDocx('style.docx', para(run('A')), { styles: ['Heading1'] });
  const r2 = await editWord.execute({ path: withStyle, operations: ops({ op: 'insert_paragraph', after: 1, text: 'Bab', style: 'heading1' }) });
  assert.equal(r2.warnings, undefined);
  assert.match(await textOf(r2.path), /\[2\] \(H1\) Bab/);
});

test('edit_word overwrite menimpa file asli dan membuat cadangan; entri zip lain tidak berubah', async () => {
  const p = await miniDocx('timpa.docx', para(run('lama')));
  fs.copyFileSync(p, path.join(dir, 'timpa-asli.docx'));
  const zip = await JSZip.loadAsync(fs.readFileSync(p));
  zip.file('word/media/gambar.bin', Buffer.from([1, 2, 3, 4]));
  fs.writeFileSync(p, await zip.generateAsync({ type: 'nodebuffer' }));

  const r = await editWord.execute({ path: p, saveMode: 'overwrite', operations: ops({ op: 'replace_text', find: 'lama', replace: 'baru' }) });
  assert.equal(r.success, true, r.error);
  assert.equal(r.path, p);
  assert.ok(fs.existsSync(r.backupPath));
  assert.equal(await textOf(p), '[1] baru');
  assert.equal(await textOf(r.backupPath), '[1] lama');
  const after = await JSZip.loadAsync(fs.readFileSync(p));
  assert.deepEqual([...(await after.file('word/media/gambar.bin').async('uint8array'))], [1, 2, 3, 4]);
});

test('validasi operasi edit_word', () => {
  const { planOperations } = editWord.__test;
  const bad = [
    'bukan json', '[]', ops({ op: 'hapus_semua' }), ops({ op: 'replace_text', find: '', replace: 'x' }),
    ops({ op: 'replace_text', find: 'a\nb', replace: 'x' }), ops({ op: 'replace_text', find: 'a', replace: 'x\ny' }),
    ops({ op: 'set_paragraph', block: 0, text: 'x' }), ops({ op: 'set_paragraph', block: 'abc', text: 'x' }),
    ops({ op: 'insert_paragraph', after: -1, text: 'x' }), ops({ op: 'insert_paragraph', after: 1, text: 'x', style: 'comic' }),
    ops({ op: 'set_table_cell', block: 1, row: 0, col: 1, text: 'x' }), ops({ op: 'append_table_row', block: 1, cells: [] }),
    ops({ op: 'append_table_row', block: 1, cells: [{ a: 1 }] }),
  ];
  for (const raw of bad) assert.equal(planOperations(raw).ok, false, raw);
  assert.equal(planOperations(ops({ op: 'set_paragraph', block: '3', text: 'x' })).ok, true, 'nomor blok berupa string angka diterima');
  assert.equal(planOperations(JSON.stringify(Array(51).fill({ op: 'delete_block', block: 1 }))).ok, false);
});

test('describe edit_word memberi peringatan untuk penghapusan', () => {
  const text = editWord.describe({
    path: path.join(dir, 'a.docx'),
    operations: ops({ op: 'delete_block', block: 3 }, { op: 'replace_text', find: 'a', replace: 'b' }),
  });
  assert.match(text, /PERHATIAN/);
  assert.match(text, /menghapus blok 3/);
  assert.match(text, /salinan baru/);
  assert.equal(editWord.alwaysConfirm, true);
});

test('artifact sesi menyimpan berkas Word dan menyuntikkannya ke prompt sebagai data', () => {
  artifacts.resetArtifacts();
  artifacts.addArtifact(createWord.toArtifact({}, { path: '/x/laporan.docx', blocks: 10, headings: [{ n: 2, level: 1, text: 'Pendahuluan' }, { n: 9, level: 1, text: 'Penutup <script>' }] }));
  const latest = artifacts.getLatest('word');
  assert.equal(latest.path, '/x/laporan.docx');
  assert.equal(latest.blocks, 10);
  assert.deepEqual(latest.headings, ['Pendahuluan', 'Penutup script']);
  const block = artifacts.renderBlock();
  assert.match(block, /word \| \/x\/laporan\.docx \| 10 blok/);
  assert.match(block, /judul: Pendahuluan \/ Penutup script/);
  assert.equal(artifacts.getLatest('excel'), null);
  artifacts.resetArtifacts();
});

test('skema tool Word/Excel-edit lengkap dan konsisten', () => {
  const editExcel = require('../src/tools/edit-excel');
  const tools = [editExcel, createWord, readWord, editWord];
  const names = new Set();
  for (const t of tools) {
    assert.match(t.name, /^[a-z_]+$/);
    assert.ok(!names.has(t.name));
    names.add(t.name);
    assert.ok(t.description.length > 80, t.name);
    assert.ok(['auto', 'confirm'].includes(t.permission), t.name);
    assert.equal(typeof t.describe, 'function');
    assert.equal(typeof t.execute, 'function');
    for (const [k, spec] of Object.entries(t.params)) {
      assert.equal(spec.type, 'string', `${t.name}.${k}`);
      assert.ok(spec.description, `${t.name}.${k}`);
    }
  }
  assert.equal(readWord.untrusted, true, 'isi dokumen luar harus diperlakukan sebagai data tak tepercaya');
  assert.equal(editWord.params.operations.raw, true);
  assert.equal(editExcel.params.operations.raw, true);
  assert.equal(core.W, W);
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
