const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_TIMEOUT_MS = 120 * 1000;
const HEAD_BYTES = 64 * 1024;
const TAIL_BYTES = 128 * 1024;

const ENV_ALLOWLIST = new Set([
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'OS', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE',
  'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'USERNAME', 'USER',
  'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432',
  'LANG', 'LC_ALL', 'SHELL', 'TERM',
]);

function buildSafeEnv(base = process.env, extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(base)) {
    if (v !== undefined && ENV_ALLOWLIST.has(k.toUpperCase())) env[k] = v;
  }
  return {
    ...env,
    CI: '1',
    FORCE_COLOR: '0',
    NO_COLOR: '1',
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
    ...extra,
  };
}

function findNpmCli({ pathEnv, platform = process.platform, exists = fs.existsSync, realpath = fs.realpathSync } = {}) {
  const raw = pathEnv !== undefined ? pathEnv : (process.env.PATH || process.env.Path || '');
  const sep = platform === 'win32' ? ';' : ':';
  for (const dir of String(raw).split(sep).filter(Boolean)) {
    const winCli = path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (exists(winCli)) return winCli;
    try {
      const real = realpath(path.join(dir, 'npm'));
      if (/npm-cli\.js$/.test(real) && exists(real)) return real;
    } catch {}
  }
  return null;
}

function nodeCommand() {
  return {
    command: process.execPath,
    extraEnv: process.versions && process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {},
  };
}

function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {}
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch {
      try { child.kill('SIGKILL'); } catch {}
    }
  }
}

function runProcess({ command, args = [], cwd, env, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const head = [];
    let headBytes = 0;
    let tail = Buffer.alloc(0);
    let dropped = 0;
    let timedOut = false;
    let settled = false;

    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });
    } catch (err) {
      resolve({ exitCode: null, signal: null, timedOut: false, durationMs: 0, output: '', droppedBytes: 0, error: err.message });
      return;
    }

    const onData = (chunk) => {
      if (headBytes < HEAD_BYTES) {
        const room = HEAD_BYTES - headBytes;
        head.push(chunk.subarray(0, room));
        headBytes += Math.min(chunk.length, room);
        chunk = chunk.subarray(room);
        if (!chunk.length) return;
      }
      tail = Buffer.concat([tail, chunk]);
      if (tail.length > TAIL_BYTES) {
        dropped += tail.length - TAIL_BYTES;
        tail = tail.subarray(tail.length - TAIL_BYTES);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    const finish = (extra) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const output = Buffer.concat(head).toString('utf8') +
        (dropped ? `\n...(${dropped} byte di tengah dibuang)...\n` : '') +
        tail.toString('utf8');
      resolve({ exitCode: null, signal: null, timedOut, durationMs: Date.now() - startedAt, output, droppedBytes: dropped, ...extra });
    };

    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    child.on('error', (err) => finish({ error: err.message }));
    child.on('close', (code, signal) => finish({ exitCode: code, signal }));
  });
}

module.exports = { runProcess, buildSafeEnv, findNpmCli, nodeCommand, DEFAULT_TIMEOUT_MS };
