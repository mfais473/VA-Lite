require('./helpers/stub-modules');
process.env.VIA_MAX_CODING_STEPS = '6';
process.env.VIA_AUTO_TOOLS = '';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const paths = require('../src/config/paths');
const store = require('../src/config/providers-store');
const clients = require('../src/ai/providers/clients');
const service = require('../src/config/settings-service');
const ws = require('../src/workspace/workspace');
const agent = require('../src/agent/agent-loop');

test('giliran agen dengan Claude: system statis, tools sama, blok thinking di-replay utuh, konteks append-only', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-aa-'));
  paths.setOverrides({ envPath: path.join(dir, '.env'), userDataDir: dir, providersPath: path.join(dir, 'providers.json') });
  store.invalidate();
  ws.setBackupDir(fs.mkdtempSync(path.join(os.tmpdir(), 'via-bak-')));
  const root = ws.setRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'via-aaw-'))).root;
  fs.writeFileSync(path.join(root, 'a.js'), 'const x = 1;\n');
  agent.cancelPending();

  const requests = [];
  const think1 = { type: 'thinking', thinking: 'langkah 1', signature: 'sig-1' };
  const think2 = { type: 'thinking', thinking: 'langkah 2', signature: 'sig-2' };
  const replies = [
    [think1, { type: 'tool_use', id: 'tu1', name: 'project_list', input: {} }],
    [think2, { type: 'tool_use', id: 'tu2', name: 'project_read_file', input: { path: 'a.js' } }],
    [{ type: 'text', text: 'Sudah kubaca.' }],
  ];
  clients.setFactoriesForTest({ anthropic: () => ({ messages: { create: async (body) => {
    requests.push(JSON.parse(JSON.stringify(body)));
    const content = replies.shift();
    return { content, stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
  } } }) });
  try {
    service.save('claude', { apiKey: 'sk-ant-AAAA1111' }, { isBusy: () => false, hasPending: () => false });
    service.setActive('claude', { isBusy: () => false, hasPending: () => false });
    const out = await agent.startTurn('lihat proyekku');
    assert.equal(out.done, true);
    assert.equal(requests.length, 3);

    assert.equal(requests[1].system, requests[0].system);
    assert.equal(requests[2].system, requests[0].system);
    assert.deepEqual(requests[1].tools, requests[0].tools);
    assert.deepEqual(requests[2].tools, requests[0].tools);
    assert.ok(requests[0].tools.some((t) => t.name === 'project_read_file') && requests[0].tools.some((t) => t.name === 'find_files'));

    for (let i = 1; i < requests.length; i += 1) {
      const prev = requests[i - 1].messages;
      assert.deepEqual(requests[i].messages.slice(0, prev.length), prev, `prefix pesan langkah ${i + 1}`);
    }
    const asst1 = requests[1].messages.find((m) => m.role === 'assistant');
    assert.deepEqual(asst1.content[0], think1);
    const asst2 = requests[2].messages.filter((m) => m.role === 'assistant')[1];
    assert.deepEqual(asst2.content[0], think2);

    const userAfterTool = requests[1].messages[requests[1].messages.length - 1];
    assert.equal(userAfterTool.content[0].type, 'tool_result');
    assert.equal(userAfterTool.content[0].tool_use_id, 'tu1');
    const noteBlock = userAfterTool.content.find((b) => b.type === 'text' && /KONTEKS SISTEM/.test(b.text));
    assert.ok(noteBlock && /MODE CODING/.test(noteBlock.text) && /Folder Proyek Aktif/.test(noteBlock.text));
    assert.ok(userAfterTool.content.indexOf(noteBlock) > 0);
    const last = requests[2].messages[requests[2].messages.length - 1];
    assert.ok(!last.content.some((b) => b.type === 'text' && /KONTEKS SISTEM/.test(b.text)));
  } finally { clients.setFactoriesForTest(); paths.setOverrides(); store.invalidate(); delete process.env.LLM_PROVIDER; delete process.env.ANTHROPIC_API_KEY; agent.cancelPending(); }
});
