'use strict';

const { MAX_READ_BYTES, MAX_WRITE_BYTES } = require('./limits');
const { isInside, clean } = require('./paths');
const { isSecretFile, policyError, nameError } = require('./policy');
const { setRoot, getRoot, getName, hasRoot, clearRoot, resolveInRoot, renderBlock, validateRoot, NO_ROOT } = require('./root');
const { setBackupDir, backupBeforeWrite, writeFileAtomic, looksBinary } = require('./files');

module.exports = {
  setRoot, getRoot, getName, hasRoot, clearRoot, resolveInRoot, policyError,
  backupBeforeWrite, writeFileAtomic, setBackupDir, looksBinary, renderBlock, clean,
  MAX_READ_BYTES, MAX_WRITE_BYTES, NO_ROOT,
  __test: { isInside, isSecretFile, nameError, validateRoot },
};
