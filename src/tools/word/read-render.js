const core = require('../docx-core');

const DEFAULT_BLOCKS = 60;
const MAX_PARA_CHARS = 800;
const MAX_TABLE_ROWS = 40;
const MAX_TABLE_COLS = 12;
const MAX_CELL_CHARS = 100;
const TEXT_BUDGET = 12000;

function visible(s) {
  return s.replace(/\t/g, '⇥').replace(/\n/g, '⏎');
}

function renderBlock(b, n) {
  if (b.kind === 'table') {
    const full = core.tableMatrix(b.node);
    const ncols = full.reduce((m, r) => Math.max(m, r.length), 0);
    let trimmed = full.length > MAX_TABLE_ROWS || ncols > MAX_TABLE_COLS;
    const shown = full.slice(0, MAX_TABLE_ROWS).map((r) => r.slice(0, MAX_TABLE_COLS).map((c) => {
      if (c.length > MAX_CELL_CHARS) { trimmed = true; return c.slice(0, MAX_CELL_CHARS); }
      return c;
    }));
    return { line: `[${n}] (TABEL ${full.length}x${ncols}) ${JSON.stringify(shown)}`, trimmed };
  }
  const raw = core.paragraphText(b.node);
  const hasImage = core.countDeep(b.node, 'drawing') + core.countDeep(b.node, 'pict') > 0;
  const level = core.headingLevel(b.node);
  const tags = [];
  if (level !== null) tags.push(level === 0 ? 'Judul' : `H${level}`);
  if (core.isListItem(b.node)) tags.push('daftar');
  if (hasImage) tags.push('gambar');
  const tag = tags.length ? `(${tags.join(', ')}) ` : '';
  if (!raw.trim()) return { line: `[${n}] ${tag}(kosong)`, trimmed: false };
  const trimmed = raw.length > MAX_PARA_CHARS;
  return { line: `[${n}] ${tag}${visible(trimmed ? raw.slice(0, MAX_PARA_CHARS) : raw)}`, trimmed };
}

function sliceDocument(opened, { startBlock = 1, maxBlocks = DEFAULT_BLOCKS } = {}) {
  const blocks = core.blocksOf(opened.body);
  const total = blocks.length;
  const last = Math.min(total, startBlock - 1 + maxBlocks);
  const lines = [];
  let chars = 0;
  let trimmedBlocks = 0;
  for (let i = startBlock - 1; i < last; i++) {
    const r = renderBlock(blocks[i], i + 1);
    if (lines.length && chars + r.line.length > TEXT_BUDGET) break;
    lines.push(r.line);
    chars += r.line.length;
    if (r.trimmed) trimmedBlocks += 1;
  }
  const endBlock = startBlock - 1 + lines.length;
  const hasMore = lines.length > 0 ? endBlock < total : false;
  return {
    lines,
    totalBlocks: total,
    trimmedBlocks,
    nextStartBlock: hasMore ? endBlock + 1 : null,
    complete: startBlock === 1 && !hasMore && trimmedBlocks === 0,
  };
}

module.exports = { DEFAULT_BLOCKS, MAX_PARA_CHARS, TEXT_BUDGET, renderBlock, sliceDocument };
