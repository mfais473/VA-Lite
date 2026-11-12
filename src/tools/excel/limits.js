const MAX_BYTES = 20 * 1024 * 1024;
const MAX_OPERATIONS = 50;
const MAX_CELLS = 5000;
const MAX_ROW = 100000;
const MAX_COL = 16384;
const MAX_ROW_COUNT = 1000;
const MAX_TEXT = 32767;
const MAX_SHEET_NAME = 31;
const SHEET_BAD_CHARS = /[\\/?*[\]:]/;
const FORMULA_BLOCKED = /\b(WEBSERVICE|HYPERLINK|IMPORT[A-Z]*|CALL|REGISTER(\.ID)?|EXEC|SHELL)\s*\(/i;

const OP_NAMES = [
  'set_cell', 'set_range', 'append_rows', 'insert_rows', 'delete_rows',
  'clear_range', 'add_sheet', 'rename_sheet', 'delete_sheet',
];

module.exports = {
  MAX_BYTES, MAX_OPERATIONS, MAX_CELLS, MAX_ROW, MAX_COL, MAX_ROW_COUNT, MAX_TEXT, MAX_SHEET_NAME,
  SHEET_BAD_CHARS, FORMULA_BLOCKED, OP_NAMES,
};
