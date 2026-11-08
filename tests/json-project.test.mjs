import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectJson, projectUsageRecord } from '../src/json-project.mjs';

test('projection discards conversation, credentials and tool bodies even when they mention usage', () => {
  const raw = JSON.stringify({ type: 'event_msg', ordinal: 7, payload: {
    type: 'task_complete', turn_id: 'turn-id', last_agent_message: 'secret token_count "input_tokens": 999',
    credentials: { api_key: 'DO_NOT_KEEP' }, turn_attribution: { turn_id: 'turn-id', instructions: 'DO_NOT_KEEP' },
  } });
  const projected = JSON.stringify(projectUsageRecord(raw));
  assert.ok(projected.includes('turn-id'));
  assert.ok(!projected.includes('DO_NOT_KEEP'));
  assert.ok(!projected.includes('last_agent_message'));
  assert.equal(projectUsageRecord(JSON.stringify({ type: 'response_item', payload: { type: 'message', content: raw } })), null);
});

test('timing projection keeps official turn duration and skips partial item windows', () => {
  const raw = JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-id',
    duration_ms: 54489, last_agent_message: 'DO_NOT_KEEP' } });
  const projected = projectUsageRecord(raw);
  assert.equal(projected.payload.duration_ms, 54489);
  assert.equal(JSON.stringify(projected).includes('DO_NOT_KEEP'), false);
  assert.equal(projectUsageRecord(JSON.stringify({ type: 'event_msg', payload: { type: 'item_completed' } })), null);
});

test('unknown subtrees are skipped; selected duplicate keys, malformed JSON and wrong types fail closed', () => {
  assert.equal(projectJson('{"keep":12,"drop":[{"body":"a\\\"b\\u1234"}]}', { keep: true }).keep, 12);
  assert.throws(() => projectJson('{"keep":1,"keep":2}', { keep: true }));
  for (const raw of ['{"keep":1,}', '{"keep":01}', '{"keep":"\\q"}', '{"keep":true} trailing']) assert.throws(() => projectJson(raw, { keep: true }));
  assert.equal(projectJson('{"keep":{"body":"private"}}', { keep: true }).keep, undefined);
});
