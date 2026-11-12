const LIMITS = Object.freeze({
  MAX_OPERATIONS: 100,        
  MAX_FILES: 10,              
  MAX_LINES: 50000,             
  MAX_OLD_CHARS: 500000,
  MAX_NEW_CHARS: 2000000,
  MAX_TOTAL_BYTES: 2 * 1024 * 1024,   
});

const DEPENDENCY_FILES = new Set(['package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']);
const OP_KINDS = ['edit', 'create', 'delete', 'rename'];

module.exports = { LIMITS, DEPENDENCY_FILES, OP_KINDS };
