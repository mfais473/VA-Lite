const fs = require('fs');

const state = { fs, batchSeq: 0 };
const lastBatchByPath = new Map();

module.exports = { state, lastBatchByPath };
