const { parseAddress, parseRange } = require('./address');
const { toCell } = require('./values');

function findSheet(wb, name) {
  const ws = name
    ? wb.worksheets.find((w) => w.name.toLowerCase() === name.toLowerCase())
    : wb.worksheets[0];
  if (!ws) {
    const names = wb.worksheets.map((w) => w.name).join(', ');
    throw new Error(name ? `Sheet \"${name}\" tidak ada. Sheet yang tersedia: ${names}` : 'File Excel tidak punya sheet');
  }
  return ws;
}

function countFormulas(wb) {
  let n = 0;
  for (const ws of wb.worksheets) {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value;
        if (v && typeof v === 'object' && (v.formula !== undefined || v.sharedFormula !== undefined)) n += 1;
      });
    });
  }
  return n;
}

function ensureNewSheetName(wb, name, ignore) {
  const clash = wb.worksheets.find((w) => w !== ignore && w.name.toLowerCase() === name.toLowerCase());
  if (clash) throw new Error(`Sheet \"${name}\" sudah ada`);
}

function applyOperations(wb, ops) {
  let lastSheet = null;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const tag = `Operasi #${i + 1} (${op.op})`;
    try {
      switch (op.op) {
        case 'set_cell': {
          const ws = findSheet(wb, op.sheet);
          const a = parseAddress(op.cell);
          ws.getCell(a.row, a.col).value = toCell(op.value);
          lastSheet = ws;
          break;
        }
        case 'set_range': {
          const ws = findSheet(wb, op.sheet);
          const a = parseAddress(op.start);
          op.values.forEach((r, ri) => r.forEach((v, ci) => {
            ws.getCell(a.row + ri, a.col + ci).value = toCell(v);
          }));
          lastSheet = ws;
          break;
        }
        case 'append_rows': {
          const ws = findSheet(wb, op.sheet);
          for (const r of op.rows) ws.addRow(r.map(toCell));
          lastSheet = ws;
          break;
        }
        case 'insert_rows': {
          const ws = findSheet(wb, op.sheet);
          for (let k = 0; k < op.count; k++) ws.insertRow(op.at, []);
          lastSheet = ws;
          break;
        }
        case 'delete_rows': {
          const ws = findSheet(wb, op.sheet);
          if (op.at > ws.rowCount) throw new Error(`baris ${op.at} di luar data (sheet punya ${ws.rowCount} baris)`);
          ws.spliceRows(op.at, op.count);
          lastSheet = ws;
          break;
        }
        case 'clear_range': {
          const ws = findSheet(wb, op.sheet);
          const r = parseRange(op.range);
          for (let row = r.r1; row <= r.r2; row++) {
            for (let col = r.c1; col <= r.c2; col++) ws.getCell(row, col).value = null;
          }
          lastSheet = ws;
          break;
        }
        case 'add_sheet': {
          ensureNewSheetName(wb, op.name);
          const ws = wb.addWorksheet(op.name);
          if (op.rows) for (const r of op.rows) ws.addRow(r.map(toCell));
          lastSheet = ws;
          break;
        }
        case 'rename_sheet': {
          const ws = findSheet(wb, op.from);
          ensureNewSheetName(wb, op.to, ws);
          ws.name = op.to;
          lastSheet = ws;
          break;
        }
        case 'delete_sheet': {
          const ws = findSheet(wb, op.name);
          if (wb.worksheets.length <= 1) throw new Error('tidak bisa menghapus satu-satunya sheet');
          wb.removeWorksheet(ws.id);
          if (lastSheet === ws) lastSheet = null;
          break;
        }
        default:
          throw new Error('op tidak dikenal');
      }
    } catch (err) {
      throw new Error(err.message.startsWith('Operasi #') ? err.message : `${tag}: ${err.message}`);
    }
  }
  return { lastSheet };
}

module.exports = { findSheet, countFormulas, applyOperations };
