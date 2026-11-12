const { W, sanitizeText } = require('./docx/xml');
const { DOC_PATH, openDocx, saveDocx } = require('./docx/package');
const {
  blocksOf, paragraphText, headingLevel, isListItem, styleIdOf, tableMatrix, tableRows, rowCells, summarize, countDeep,
} = require('./docx/reading');
const { STYLE_MAP, createEditor, applyOp } = require('./docx/editor');

module.exports = {
  W, DOC_PATH, STYLE_MAP,
  openDocx, saveDocx, createEditor, applyOp,
  blocksOf, paragraphText, headingLevel, isListItem, styleIdOf, tableMatrix, tableRows, rowCells,
  summarize, sanitizeText, countDeep,
};
