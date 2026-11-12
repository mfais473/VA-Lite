const path = require('path');
const fs = require('fs/promises');
const { isInsideAllowed, allowedRoots, resolveUserPath, defaultSaveDir } = require('./path-guard');
const { safeName, withExt, uniquePath } = require('./file-utils');
const core = require('./docx-core');
const { MAX_BLOCKS, parseContent } = require('./word/content');
const { inlineRuns, buildDocument } = require('./word/build');

const createWord = {
  name: 'create_word',
  description:
    'Membuat file Word (.docx) BARU dari daftar blok. Pakai saat pengguna minta dokumen, laporan, surat, ' +
    'atau catatan dijadikan file Word. Blok: title, heading (level 1-6), paragraph, bullets, numbered, ' +
    'table (baris pertama = header), page_break. Teks boleh memuat **tebal**. Jangan mengarang isi yang tidak ' +
    'diberikan pengguna atau tidak terbaca jelas. Untuk MENGUBAH dokumen yang sudah ada, pakai read_word lalu edit_word, ' +
    'bukan membuat ulang.',
  params: {
    fileName: { type: 'string', required: true, description: 'Nama file, mis. laporan-praktikum.docx' },
    content: {
      type: 'string',
      required: true,
      description:
        'JSON array blok. Contoh: [{\"type\":\"title\",\"text\":\"Laporan\"},{\"type\":\"heading\",\"level\":1,\"text\":\"Pendahuluan\"},' +
        '{\"type\":\"paragraph\",\"text\":\"Isi dengan **kata tebal**.\"},{\"type\":\"bullets\",\"items\":[\"satu\",\"dua\"]},' +
        '{\"type\":\"numbered\",\"items\":[\"langkah 1\",\"langkah 2\"]},{\"type\":\"table\",\"rows\":[[\"Nama\",\"Nilai\"],[\"Budi\",85]]}]',
    },
    folder: { type: 'string', required: false, description: 'Folder simpan (default: Documents)' },
  },
  permission: 'confirm',
  untrusted: false,
  describe: ({ fileName, content }) => {
    let n = '';
    try { n = ` dengan ${JSON.parse(content).length} blok`; } catch {}
    return `Boleh aku buat file Word ${fileName ? safeName(fileName) : 'baru'}${n}?`;
  },
  validate: ({ content }) => {
    const parsed = parseContent(content);
    return parsed.error || null;
  },
  toArtifact: (args, result) => ({
    type: 'word',
    path: result.path,
    blocks: result.blocks,
    headings: (result.headings || []).map((h) => h.text),
  }),
  execute: async ({ fileName, content, folder }) => {
    const parsed = parseContent(content);
    if (parsed.error) return { success: false, error: parsed.error };
    const name = withExt(safeName(fileName, 'dokumen', '.docx'), '.docx');
    const dir = folder ? resolveUserPath(folder) : defaultSaveDir();
    if (!isInsideAllowed(dir)) {
      return { success: false, error: `Folder di luar area yang diizinkan. Folder yang diizinkan: ${allowedRoots().join(' ; ')}` };
    }
    try {
      await fs.mkdir(dir, { recursive: true });
      const outPath = await uniquePath(path.join(dir, name));
      if (!outPath) return { success: false, error: 'Tidak bisa menentukan nama file unik' };
      const { Packer } = require('docx');
      const buffer = await Packer.toBuffer(buildDocument(parsed.blocks));
      await fs.writeFile(outPath, buffer);
      const info = core.summarize(await core.openDocx(buffer));
      return {
        success: true,
        path: outPath,
        blocks: info.blocks,
        paragraphs: info.paragraphs,
        tables: info.tables,
        headings: info.headings.slice(0, 20),
        message: `File Word disimpan di ${outPath}`,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
};

module.exports = createWord;
module.exports.__test = { parseContent, buildDocument, inlineRuns, MAX_BLOCKS };
