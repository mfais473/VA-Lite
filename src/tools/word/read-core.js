const fs = require('fs/promises');
const { toInt } = require('../file-utils');
const core = require('../docx-core');
const { DEFAULT_BLOCKS, sliceDocument } = require('./read-render');

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_BLOCKS_PER_CALL = 200;
const OUTLINE_LIMIT = 40;

async function readWordFile(target, { startBlock, maxBlocks } = {}) {
  const stat = await fs.stat(target);
  if (!stat.isFile()) return { success: false, error: 'Path bukan file' };
  if (stat.size > MAX_BYTES) return { success: false, error: 'File Word terlalu besar (maks 20 MB)' };
  const opened = await core.openDocx(await fs.readFile(target));
  const info = core.summarize(opened);
  const start = toInt(startBlock, 1, 1, 1000000);
  const limit = toInt(maxBlocks, DEFAULT_BLOCKS, 1, MAX_BLOCKS_PER_CALL);
  const slice = sliceDocument(opened, { startBlock: start, maxBlocks: limit });
  const result = {
    success: true,
    path: target,
    totalBlocks: slice.totalBlocks,
    paragraphs: info.paragraphs,
    tables: info.tables,
    startBlock: start,
    returnedBlocks: slice.lines.length,
    nextStartBlock: slice.nextStartBlock,
    complete: slice.complete,
    outline: info.headings.slice(0, OUTLINE_LIMIT).map((h) => ({ n: h.n, level: h.level, text: h.text.slice(0, 80) })),
    features: info.features,
    text: slice.lines.join('\n'),
  };
  if (!slice.complete) {
    const reasons = [];
    if (start > 1) reasons.push('dibaca mulai di tengah dokumen');
    if (slice.nextStartBlock) reasons.push('masih ada blok berikutnya');
    if (slice.trimmedBlocks) reasons.push(`${slice.trimmedBlocks} blok dipotong`);
    result.note =
      `Data BELUM lengkap (${reasons.join('; ') || 'sebagian'}). ` +
      'Jangan menimpa isi blok yang belum kamu baca utuh.';
  }
  if (info.features.trackedChanges) {
    result.warning = 'Dokumen memuat tracked changes; edit_word menulis perubahan langsung (tanpa dilacak).';
  }
  return result;
}

module.exports = { readWordFile, MAX_BYTES, MAX_BLOCKS_PER_CALL, OUTLINE_LIMIT };
