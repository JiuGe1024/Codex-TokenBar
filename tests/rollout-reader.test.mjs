import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { RolloutReader, findRollout } from '../src/rollout-reader.mjs';

const thread = '00000000-0000-0000-0000-000000000001';
const turn = '00000000-0000-0000-0000-000000000002';
const line = (value) => JSON.stringify(value) + '\n';
const header = line({ type: 'session_meta', payload: { id: thread } });
const started = line({ type: 'event_msg', payload: { type: 'task_started', turn_id: turn } });
const complete = line({ type: 'event_msg', payload: { type: 'task_complete', turn_id: turn, last_agent_message: 'DO_NOT_DESERIALIZE' } });
const u = { input_tokens: 100, cached_input_tokens: 80, output_tokens: 10, total_tokens: 110 };
const modern = line({ type: 'token_usage_record', payload: { thread_id: thread, turn_id: turn, response_id: 'resp_1', usage: u, turn_token_usage: u, thread_token_usage: u } });

test('incremental reader handles split UTF-8 and partial lines, then resets after file replacement', async () => {
  const base = path.resolve('work'); await fs.mkdir(base, { recursive: true });
  const folder = await fs.mkdtemp(path.join(base, 'reader-test-'));
  assert.ok(!path.relative(base, folder).startsWith('..'));
  try {
    const file = path.join(folder, `rollout-test-${thread}.jsonl`);
    const message = Buffer.from(line({ type: 'response_item', payload: { type: 'message', content: '秘密' } }));
    const split = message.indexOf(Buffer.from('秘密')) + 1;
    await fs.writeFile(file, Buffer.concat([Buffer.from(header + started), message.subarray(0, split)]));
    const reader = new RolloutReader(file, thread); await reader.poll();
    assert.equal(reader.state.row(turn), null);
    await fs.appendFile(file, Buffer.concat([message.subarray(split), Buffer.from(modern + complete.slice(0, -1))]));
    await reader.poll(); assert.equal(reader.state.row(turn), null, 'unterminated completion must wait');
    await fs.appendFile(file, '\n'); await reader.poll();
    assert.equal(reader.state.row(turn).turn.total, 110);
    const offset = reader.offset; await reader.poll(); assert.equal(reader.offset, offset);
    assert.equal(reader.state.duplicates, 0);
    assert.equal(await findRollout(folder, thread), await fs.realpath(file));
    await fs.writeFile(file, header); await reader.poll();
    assert.equal(reader.state.row(turn), null, 'truncation clears old snapshots');
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
});
