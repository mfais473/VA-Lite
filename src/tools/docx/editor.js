const { isW, elementChildren, childW } = require('./xml');
const { styleIdsOf } = require('./package');
const { blocksOf, headingLevel, tableRows, rowCells, cellParagraphs } = require('./reading');
const { firstRunProps, complexityOf, setParagraphText, newParagraph } = require('./paragraph');
const { countInParagraph, replaceInParagraph, paragraphsOfBlock } = require('./replace');

const STYLE_MAP = {
  normal: null, title: 'Title',
  heading1: 'Heading1', heading2: 'Heading2', heading3: 'Heading3',
  heading4: 'Heading4', heading5: 'Heading5', heading6: 'Heading6',
};

async function createEditor(opened) {
  return {
    opened,
    doc: opened.dom,
    body: opened.body,
    styles: await styleIdsOf(opened.zip),
    snap: blocksOf(opened.body).map((b) => ({ ...b, deleted: false })),
    tails: new Map(),
    warnings: [],
    stats: { replaced: 0, paragraphsSet: 0, inserted: 0, deleted: 0, cellsSet: 0, rowsAdded: 0, rowsDeleted: 0 },
  };
}

function block(ed, n, kind) {
  if (!Number.isInteger(n) || n < 1 || n > ed.snap.length) {
    throw new Error(`block ${n} tidak ada (dokumen punya ${ed.snap.length} blok)`);
  }
  const b = ed.snap[n - 1];
  if (b.deleted) throw new Error(`block ${n} sudah dihapus oleh operasi sebelumnya`);
  if (kind && b.kind !== kind) {
    throw new Error(`block ${n} adalah ${b.kind === 'p' ? 'paragraf' : 'tabel'}, bukan ${kind === 'p' ? 'paragraf' : 'tabel'}`);
  }
  return b;
}

function insertAfter(ref, node) {
  ref.parentNode.insertBefore(node, ref.nextSibling);
}

function appendToBody(ed, node) {
  const sect = elementChildren(ed.body).find((c) => isW(c, 'sectPr'));
  ed.body.insertBefore(node, sect || null);
}

function styleFor(ed, key) {
  const k = String(key || 'normal').toLowerCase();
  if (!(k in STYLE_MAP)) throw new Error(`style \"${key}\" tidak dikenal. Pilihan: ${Object.keys(STYLE_MAP).join(', ')}`);
  const id = STYLE_MAP[k];
  if (id && !ed.styles.has(id)) {
    ed.warnings.push(`Gaya ${id} tidak ada di dokumen ini; paragraf baru memakai gaya normal.`);
    return null;
  }
  return id;
}

function cellAt(ed, n, row, col) {
  const tbl = block(ed, n, 'table').node;
  const rows = tableRows(tbl);
  if (!Number.isInteger(row) || row < 1 || row > rows.length) throw new Error(`baris ${row} tidak ada di tabel (punya ${rows.length} baris)`);
  const cells = rowCells(rows[row - 1]);
  if (!Number.isInteger(col) || col < 1 || col > cells.length) throw new Error(`kolom ${col} tidak ada di baris ${row} (punya ${cells.length} sel)`);
  return cells[col - 1];
}

function setCellText(ed, tc, text) {
  const paras = cellParagraphs(tc);
  if (!paras.length) { tc.appendChild(newParagraph(ed.doc, text)); return; }
  for (const extra of paras.slice(1)) {
    const why = complexityOf(extra);
    if (why) throw new Error(`sel berisi paragraf dengan ${why}; tidak aman ditimpa`);
  }
  setParagraphText(ed.doc, paras[0], text);
  for (const extra of paras.slice(1)) tc.removeChild(extra);
}

function applyOp(ed, op) {
  switch (op.op) {
    case 'replace_text': {
      const scope = op.block !== undefined
        ? [block(ed, op.block)]
        : blocksOf(ed.body);
      const paras = scope.flatMap(paragraphsOfBlock);
      const total = paras.reduce((n, p) => n + countInParagraph(p, op.find, op.matchCase), 0);
      if (total === 0) {
        throw new Error(`teks \"${op.find.slice(0, 60)}\" tidak ditemukan${op.block !== undefined ? ` di block ${op.block}` : ' di dokumen'}`);
      }
      if (total > 1 && !op.replaceAll) {
        throw new Error(`teks \"${op.find.slice(0, 60)}\" ditemukan ${total} kali; beri \"block\" yang lebih spesifik atau set replaceAll=true`);
      }
      for (const p of paras) ed.stats.replaced += replaceInParagraph(ed.doc, p, op.find, op.replace, op.matchCase);
      return;
    }
    case 'set_paragraph': {
      setParagraphText(ed.doc, block(ed, op.block, 'p').node, op.text);
      ed.stats.paragraphsSet += 1;
      return;
    }
    case 'insert_paragraph': {
      const styleId = styleFor(ed, op.style);
      let ref = null;
      if (op.after >= 1) ref = block(ed, op.after);
      const rPr = !styleId && ref && ref.kind === 'p' && headingLevel(ref.node) === null ? firstRunProps(ref.node) : null;
      const p = newParagraph(ed.doc, op.text, { styleId, rPr });
      const tail = ed.tails.get(op.after);
      if (tail && tail.parentNode) {
        insertAfter(tail, p);
      } else if (ref) {
        insertAfter(ref.node, p);
      } else {
        const first = ed.snap.find((b) => !b.deleted);
        if (first) first.node.parentNode.insertBefore(p, first.node);
        else appendToBody(ed, p);
      }
      ed.tails.set(op.after, p);
      ed.stats.inserted += 1;
      return;
    }
    case 'append_paragraph': {
      appendToBody(ed, newParagraph(ed.doc, op.text, { styleId: styleFor(ed, op.style) }));
      ed.stats.inserted += 1;
      return;
    }
    case 'delete_block': {
      const b = block(ed, op.block);
      if (b.kind === 'p') {
        const why = complexityOf(b.node);
        if (why && why === 'pemisah seksi') throw new Error(`block ${op.block} memuat pemisah seksi; tidak boleh dihapus`);
      }
      b.node.parentNode.removeChild(b.node);
      b.deleted = true;
      const rest = elementChildren(ed.body).filter((c) => !isW(c, 'sectPr'));
      if (rest.length && isW(rest[rest.length - 1], 'tbl')) {
        throw new Error('dokumen tidak boleh berakhir dengan tabel; sisakan satu paragraf setelahnya');
      }
      ed.stats.deleted += 1;
      return;
    }
    case 'set_table_cell': {
      setCellText(ed, cellAt(ed, op.block, op.row, op.col), op.text);
      ed.stats.cellsSet += 1;
      return;
    }
    case 'append_table_row': {
      const tbl = block(ed, op.block, 'table').node;
      const rows = tableRows(tbl);
      if (!rows.length) throw new Error('tabel kosong');
      const clone = rows[rows.length - 1].cloneNode(true);
      const trPr = childW(clone, 'trPr');
      if (trPr) {
        const hdr = childW(trPr, 'tblHeader');
        if (hdr) trPr.removeChild(hdr);
      }
      const cells = rowCells(clone);
      if (op.cells.length > cells.length) throw new Error(`baris punya ${cells.length} kolom, tapi diberi ${op.cells.length} nilai`);
      cells.forEach((tc, i) => setCellText(ed, tc, op.cells[i] === undefined ? '' : op.cells[i]));
      insertAfter(rows[rows.length - 1], clone);
      ed.stats.rowsAdded += 1;
      return;
    }
    case 'delete_table_row': {
      const tbl = block(ed, op.block, 'table').node;
      const rows = tableRows(tbl);
      if (!Number.isInteger(op.row) || op.row < 1 || op.row > rows.length) {
        throw new Error(`baris ${op.row} tidak ada di tabel (punya ${rows.length} baris)`);
      }
      if (rows.length === 1) throw new Error('tidak bisa menghapus satu-satunya baris tabel; hapus tabelnya dengan delete_block');
      tbl.removeChild(rows[op.row - 1]);
      ed.stats.rowsDeleted += 1;
      return;
    }
    default:
      throw new Error(`op \"${op.op}\" tidak dikenal`);
  }
}

module.exports = { STYLE_MAP, createEditor, applyOp };
