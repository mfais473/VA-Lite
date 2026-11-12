require('./helpers/stub-modules');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const paths = require('../src/config/paths');
const envStore = require('../src/config/env-store');

function tmpEnv(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-env-'));
  const file = path.join(dir, '.env');
  if (content !== undefined) fs.writeFileSync(file, content);
  paths.setOverrides({ envPath: file, userDataDir: dir, providersPath: path.join(dir, 'providers.json') });
  return { dir, file };
}
const cleanup = (...keys) => { for (const k of keys) delete process.env[k]; paths.setOverrides(); };

test('allowlist: LLM_PROVIDER, *_API_KEY, *_BASE_URL, *_MODEL_*, dan parameter VIA_* yang terdaftar di skema', () => {
  for (const k of ['LLM_PROVIDER', 'OPENAI_API_KEY', 'VIA_PROVIDER_MY_LLM_API_KEY', 'ANOMAN_BASE_URL', 'GEMINI_MODEL_PRIMARY', 'CLAUDE_MODEL_CODING',
    'VIA_AUTO_TOOLS', 'VIA_ALLOWED_DIRS', 'VIA_MAX_AGENT_STEPS']) {
    assert.ok(envStore.isAllowedKey(k), k);
  }
  for (const k of ['PATH', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'VIA_TIDAK_ADA', 'VIA_ALLOWED_DIRS_X', 'openai_api_key', '_API_KEY', 'X', 'A B_API_KEY']) {
    assert.ok(!envStore.isAllowedKey(k), k);
  }
});

test('apply: komentar dan baris lain dipertahankan; hanya kunci yang disentuh berubah', () => {
  const { file } = tmpEnv('# komentar atas\nVIA_AUTO_TOOLS=open_browser\nGEMINI_API_KEY=lama\n\n# akhir\nLLM_PROVIDER=gemini\n');
  try {
    envStore.apply({ set: { GEMINI_API_KEY: 'baru123' } });
    assert.equal(fs.readFileSync(file, 'utf8'),
      '# komentar atas\nVIA_AUTO_TOOLS=open_browser\nGEMINI_API_KEY=baru123\n\n# akhir\nLLM_PROVIDER=gemini\n');
    assert.equal(process.env.GEMINI_API_KEY, 'baru123');
  } finally { cleanup('GEMINI_API_KEY'); }
});

test('apply: kunci baru ditambahkan di akhir; berkas belum ada dibuat; CRLF dipertahankan', () => {
  const { file } = tmpEnv();
  try {
    envStore.apply({ set: { OPENAI_API_KEY: 'sk-abc12345' } });
    assert.equal(fs.readFileSync(file, 'utf8'), 'OPENAI_API_KEY=sk-abc12345\n');
    fs.writeFileSync(file, 'A=1\r\nLLM_PROVIDER=gemini\r\n');
    envStore.apply({ set: { LLM_PROVIDER: 'claude' } });
    assert.equal(fs.readFileSync(file, 'utf8'), 'A=1\r\nLLM_PROVIDER=claude\r\n');
  } finally { cleanup('OPENAI_API_KEY', 'LLM_PROVIDER'); }
});

test('apply: nilai berisi CR/LF/NUL ditolak, tidak ada yang tertulis, process.env tidak berubah', () => {
  const { file } = tmpEnv('GEMINI_API_KEY=asli\n');
  try {
    for (const bad of ['a\nB_API_KEY=x', 'a\rb', 'a\u0000b']) {
      assert.throws(() => envStore.apply({ set: { GEMINI_API_KEY: bad } }), (e) => !e.message.includes('B_API_KEY=x'));
    }
    assert.equal(fs.readFileSync(file, 'utf8'), 'GEMINI_API_KEY=asli\n');
    assert.notEqual(process.env.GEMINI_API_KEY, 'a\nB_API_KEY=x');
  } finally { cleanup('GEMINI_API_KEY'); }
});

test('apply: kunci di luar allowlist ditolak; satu kunci buruk membatalkan seluruh perubahan', () => {
  const { file } = tmpEnv('A=1\n');
  try {
    assert.throws(() => envStore.apply({ set: { NODE_OPTIONS: '--inspect' } }), /tidak diizinkan/);
    assert.throws(() => envStore.apply({ set: { OPENAI_API_KEY: 'ok1234567', PATH: 'x' } }), /tidak diizinkan/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'A=1\n');
    assert.equal(process.env.OPENAI_API_KEY, undefined);
  } finally { cleanup('OPENAI_API_KEY'); }
});

test('apply: tulis atomik (tanpa berkas .tmp tersisa), izin 0600 bila didukung, kegagalan tidak mengubah process.env', () => {
  const { dir, file } = tmpEnv('A=1\n');
  try {
    envStore.apply({ set: { OPENAI_API_KEY: 'sk-abc12345' } });
    assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')), []);
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);

    const blocked = path.join(dir, 'blok');
    fs.mkdirSync(blocked);
    paths.setOverrides({ envPath: blocked });
    delete process.env.CLAUDE_MODEL_CODING;
    assert.throws(() => envStore.apply({ set: { CLAUDE_MODEL_CODING: 'x-model' } }));
    assert.equal(process.env.CLAUDE_MODEL_CODING, undefined, 'process.env hanya diubah setelah tulis sukses');
    assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')), []);
  } finally { cleanup('OPENAI_API_KEY', 'CLAUDE_MODEL_CODING'); }
});

test('apply: nilai dikutip bila perlu dan terbaca kembali sama persis', () => {
  const { file } = tmpEnv();
  try {
    const tricky = 'a b #c "d" \\e';
    envStore.apply({ set: { ANOMAN_BASE_URL: tricky } });
    assert.equal(envStore.parse(fs.readFileSync(file, 'utf8')).ANOMAN_BASE_URL, tricky);
  } finally { cleanup('ANOMAN_BASE_URL'); }
});

test('apply: remove menghapus baris dan variabel proses; duplikat disatukan', () => {
  const { file } = tmpEnv('X_API_KEY=1\nOPENAI_API_KEY=a\nOPENAI_API_KEY=b\n');
  try {
    process.env.X_API_KEY = '1';
    envStore.apply({ set: { OPENAI_API_KEY: 'ccccccc' }, remove: ['X_API_KEY'] });
    assert.equal(fs.readFileSync(file, 'utf8'), 'OPENAI_API_KEY=ccccccc\n');
    assert.equal(process.env.X_API_KEY, undefined);
  } finally { cleanup('OPENAI_API_KEY', 'X_API_KEY'); }
});

test('load: mengisi process.env tanpa menimpa yang sudah ada; .env lama (GEMINI_*, ANOMAN_*, LLM_PROVIDER) terbaca', () => {
  tmpEnv('# lama\nLLM_PROVIDER=anoman\nANOMAN_API_KEY="kunci-lama"\nANOMAN_MODEL_PRIMARY=claude-haiku-4-5 # komentar\nGEMINI_API_KEY=g-key\n');
  const keys = ['LLM_PROVIDER', 'ANOMAN_API_KEY', 'ANOMAN_MODEL_PRIMARY', 'GEMINI_API_KEY'];
  try {
    for (const k of keys) delete process.env[k];
    process.env.GEMINI_API_KEY = 'dari-shell';
    envStore.load({ force: true });
    assert.equal(process.env.LLM_PROVIDER, 'anoman');
    assert.equal(process.env.ANOMAN_API_KEY, 'kunci-lama');
    assert.equal(process.env.ANOMAN_MODEL_PRIMARY, 'claude-haiku-4-5');
    assert.equal(process.env.GEMINI_API_KEY, 'dari-shell');
  } finally { cleanup(...keys); envStore.__test.resetLoaded(); }
});
