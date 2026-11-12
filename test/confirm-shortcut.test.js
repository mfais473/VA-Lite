require('./helpers/stub-modules');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { shortcutDecision } = require('../src/agent/confirmation');
const agent = require('../src/agent/agent-loop');

test('shortcutDecision: hanya approve/deny/ask; format lama {approved} dan payload asing ditolak', () => {
  assert.deepEqual(shortcutDecision({ decision: 'approve' }), { decision: 'approve' });
  assert.deepEqual(shortcutDecision({ decision: 'deny' }), { decision: 'deny' });
  assert.deepEqual(shortcutDecision({ decision: 'ask' }), { decision: 'ask' });
  for (const bad of [{ approved: true }, { decision: 'yes' }, { decision: true }, { decision: '__proto__' }, { decision: 'toString' }, null, undefined, 'approve', 42, {}]) {
    assert.equal(shortcutDecision(bad), null, JSON.stringify(bad));
  }
});

test('teks izin mengajak klik Ya/Tidak/Tanya dulu atau mengetik jawaban; tanpa petunjuk keyboard/suara', () => {
  const t = agent.__test.permissionPrompt('Boleh aku menerapkan patch?', 'alasan');
  assert.match(t, /Alasanku: alasan\./);
  assert.match(t, /Klik Ya, Tidak, atau Tanya dulu/);
  assert.match(t, /ketik jawabanmu/);
  assert.ok(!/tekan|suara|\bR\b/i.test(t), t);
});

test('sumber UI/preload/IPC: tombol izin memakai payload {decision}', () => {
  const chat = fs.readFileSync(require.resolve('../src/ui/chat.js'), 'utf8');
  for (const d of ['approve', 'deny', 'ask']) assert.match(chat, new RegExp(`decision: '${d}'`));
  assert.match(chat, /confirmShortcut\(choice\.decision\)/);
  const pre = fs.readFileSync(require.resolve('../preload.js'), 'utf8');
  assert.match(pre, /\{ decision \}/);
  assert.ok(!/approved/.test(pre));
  const ipc = fs.readFileSync(require.resolve('../src/core/ipc-handlers.js'), 'utf8');
  assert.match(ipc, /shortcutDecision\(payload\)/);
  assert.ok(!/\{ approved \}/.test(ipc));
});

test('sistem voice dan avatar 3D sudah hilang dari kode aplikasi', () => {
  const root = path.join(__dirname, '..');
  const files = ['main.js', 'preload.js', 'index.html'];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|css|html)$/.test(e.name)) files.push(path.relative(root, p));
    }
  };
  walk(path.join(root, 'src'));
  const banned = /elevenlabs|getUserMedia|MediaRecorder|AudioContext|three-vrm|from 'three'|\bVRM\b|lipsync|processTurn|speechBubble/i;
  for (const f of files) {
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(!banned.test(text), `${f} masih menyebut voice/avatar: ${text.match(banned)}`);
  }
  for (const dir of ['avatar', 'audio', 'parser', 'input']) {
    assert.ok(!fs.existsSync(path.join(root, 'src', dir)), `src/${dir} seharusnya sudah dihapus`);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  assert.ok(!deps.some((d) => /three|pixiv/.test(d)), deps.join(','));
});

test('prompt tidak lagi memuat tag ekspresi/gerak atau aturan suara', () => {
  const { SYSTEM_PROMPT } = require('../src/ai/prompt-builder');
  const { CODING_PROMPT } = require('../src/ai/coding-prompt');
  for (const text of [SYSTEM_PROMPT, CODING_PROMPT]) {
    assert.ok(!/\[(senang|sedih|tenang|netral|gerak:)/i.test(text));
    assert.ok(!/suara|avatar|diucapkan|dibacakan/i.test(text));
  }
});
