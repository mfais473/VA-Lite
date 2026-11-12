const CONTENT_WIDTH = 9026;

function inlineRuns(docx, text, base = {}) {
  const { TextRun } = docx;
  const runs = [];
  text.split(/\*\*(.+?)\*\*/g).forEach((part, i) => {
    if (part === '') return;
    part.split('\n').forEach((line, j) => {
      runs.push(new TextRun({ text: line, ...base, ...(i % 2 === 1 ? { bold: true } : {}), ...(j > 0 ? { break: 1 } : {}) }));
    });
  });
  return runs.length ? runs : [new TextRun({ text: '', ...base })];
}

function headingStyles() {
  const sizes = [32, 28, 24, 22, 22, 22];
  const styles = sizes.map((size, i) => ({
    id: `Heading${i + 1}`, name: `Heading ${i + 1}`, basedOn: 'Normal', next: 'Normal', quickFormat: true,
    run: { size, bold: true, font: 'Calibri' },
    paragraph: { spacing: { before: i === 0 ? 360 : 240, after: 120 }, outlineLevel: i },
  }));
  styles.unshift({
    id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', quickFormat: true,
    run: { size: 44, bold: true, font: 'Calibri' },
    paragraph: { spacing: { after: 240 } },
  });
  return styles;
}

function buildDocument(blocks) {
  const docx = require('docx');
  const {
    Document, Paragraph, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
    LevelFormat, AlignmentType, HeadingLevel, PageBreak,
  } = docx;
  const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];

  const numbering = [{
    reference: 'via-bullets',
    levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
  }];
  let numberedCount = 0;
  const border = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
  const children = [];

  blocks.forEach((b, idx) => {
    switch (b.type) {
      case 'title':
        children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: inlineRuns(docx, b.text) }));
        break;
      case 'heading':
        children.push(new Paragraph({ heading: HEADINGS[b.level - 1], children: inlineRuns(docx, b.text) }));
        break;
      case 'paragraph':
        children.push(new Paragraph({ children: inlineRuns(docx, b.text) }));
        break;
      case 'bullets':
        for (const it of b.items) children.push(new Paragraph({ numbering: { reference: 'via-bullets', level: 0 }, children: inlineRuns(docx, it) }));
        break;
      case 'numbered': {
        numberedCount += 1;
        const reference = `via-numbered-${numberedCount}`;
        numbering.push({
          reference,
          levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
        });
        for (const it of b.items) children.push(new Paragraph({ numbering: { reference, level: 0 }, children: inlineRuns(docx, it) }));
        break;
      }
      case 'table': {
        const cols = b.rows.reduce((m, r) => Math.max(m, r.length), 1);
        const widths = Array(cols).fill(Math.floor(CONTENT_WIDTH / cols));
        widths[cols - 1] += CONTENT_WIDTH - widths.reduce((a, c) => a + c, 0);
        const rows = b.rows.map((r, ri) => {
          const isHead = b.header && ri === 0;
          return new TableRow({
            tableHeader: isHead,
            children: widths.map((w, ci) => new TableCell({
              width: { size: w, type: WidthType.DXA },
              margins: { top: 60, bottom: 60, left: 100, right: 100 },
              ...(isHead ? { shading: { type: ShadingType.CLEAR, fill: 'E7E6E6', color: 'auto' } } : {}),
              children: [new Paragraph({ children: inlineRuns(docx, r[ci] === undefined ? '' : r[ci], isHead ? { bold: true } : {}) })],
            })),
          });
        });
        children.push(new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: widths,
          borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
          rows,
        }));
        const next = blocks[idx + 1];
        if (!next || next.type === 'table') children.push(new Paragraph({}));
        break;
      }
      case 'page_break':
        children.push(new Paragraph({ children: [new PageBreak()] }));
        break;
      default:
        break;
    }
  });

  return new Document({
    creator: 'Via',
    styles: {
      default: { document: { run: { font: 'Calibri', size: 22 }, paragraph: { spacing: { after: 120, line: 276 } } } },
      paragraphStyles: headingStyles(),
    },
    numbering: { config: numbering },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      children,
    }],
  });
}

module.exports = { inlineRuns, buildDocument };
