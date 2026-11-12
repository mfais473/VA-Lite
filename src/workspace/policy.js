const { IS_WIN } = require('../shared/platform');

const SECRET_DIR_NAMES = ['.git', '.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker'];
const SECRET_FILE_NAMES = ['.npmrc', '.pypirc', '.netrc', '_netrc', '.git-credentials'];
const SECRET_EXTENSIONS = ['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore', '.kdbx'];
const ENV_SAFE_SUFFIXES = ['.example', '.sample', '.template', '.dist'];
const WRITE_PROTECTED_DIRS = ['.vscode', '.idea', '.husky', '.github', 'node_modules'];

function isSecretFile(lowerName) {
  if (lowerName === '.env' || lowerName.startsWith('.env.')) {
    return !ENV_SAFE_SUFFIXES.some((s) => lowerName.endsWith(s));
  }
  if (SECRET_FILE_NAMES.includes(lowerName)) return true;
  if (/^id_(rsa|dsa|ecdsa|ed25519)/.test(lowerName)) return true;
  return SECRET_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
}

function policyError(parts, mode) {
  const lower = parts.filter(Boolean).map((p) => p.toLowerCase());
  for (const seg of lower) {
    if (SECRET_DIR_NAMES.includes(seg)) {
      return 'Path ini termasuk area rahasia/internal (mis. .git, .ssh) dan tidak boleh disentuh';
    }
  }
  const name = lower[lower.length - 1] || '';
  if (isSecretFile(name)) {
    return 'File ini tampaknya berisi rahasia (mis. .env, kunci privat) dan tidak boleh disentuh';
  }
  if (mode === 'write') {
    for (const seg of lower) {
      if (WRITE_PROTECTED_DIRS.includes(seg)) return `Folder "${seg}" dilindungi dari penulisan`;
    }
  }
  return null;
}

const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function nameError(rel) {
  if (/[\u0000-\u001f]/.test(rel)) return 'Path mengandung karakter kontrol';
  if (!IS_WIN) return null;
  if (/[<>:"|?*]/.test(rel)) return 'Path mengandung karakter yang tidak diizinkan';
  for (const seg of rel.split(/[\\/]/)) {
    if (!seg || seg === '.' || seg === '..') continue;
    if (WIN_RESERVED.test(seg)) return 'Nama file/folder ini dicadangkan oleh Windows';
    if (/[. ]$/.test(seg)) return 'Nama tidak boleh diakhiri titik atau spasi';
  }
  return null;
}

module.exports = { isSecretFile, policyError, nameError };
