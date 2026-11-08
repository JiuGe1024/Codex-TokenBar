import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UsageState, usage } from '../src/usage-state.mjs';

export const thread = '00000000-0000-0000-0000-000000000001';
export const turnA = '00000000-0000-0000-0000-000000000002';
export const turnB = '00000000-0000-0000-0000-000000000003';
export const header = () => ({ type: 'session_meta', payload: { id: thread, parent_thread_id: null } });
export const event = (type, turn_id) => ({ type: 'event_msg', payload: { type, turn_id } });
export const rawUsage = (input, cached, output) => ({ input_tokens: input, cached_input_tokens: cached, output_tokens: output, total_tokens: input + output });
export const record = (turnId, response, own, turn = own, total = turn) => ({ type: 'token_usage_record', payload: {
  thread_id: thread, turn_id: turnId, response_id: response, usage: own, turn_token_usage: turn, thread_token_usage: total,
} });

test('duration without tools retains waiting time and requires lifecycle timing evidence', () => {
  for (const duration of [54489, undefined, 0, -1]) {
    const s = new UsageState(thread); s.apply(header()); s.apply(event('task_started', turnA));
    s.apply(record(turnA, 'response', rawUsage(538769, 530000, 928)));
    s.apply({ type: 'event_msg', payload: { type: 'item_completed', turn_id: turnA, item: { id: 'model', type: 'AgentMessage' }, started_at_ms: 60000, completed_at_ms: 61000 } });
    s.apply({ type: 'event_msg', timestamp: new Date(100000).toISOString(), payload: { type: 'task_complete', turn_id: turnA, duration_ms: duration } });
    const row = s.row(turnA);
    assert.equal(row.speed, duration > 0 ? 928000 / duration : null);
    assert.equal(row.durationMs, duration >= 0 ? duration : null);
    if (duration > 0) assert.ok(Math.abs(row.speed * row.durationMs / 1000 - row.turn.output) < 1e-9);
  }
});

test('tool union is deducted once, clipped to the turn, with model overlap preserved', () => {
  const s = new UsageState(thread); s.apply(header()); s.apply(event('task_started', turnA));
  s.apply(record(turnA, 'response', rawUsage(100, 80, 600)));
  const item = (id, type, start, end, kind) => ({ type: 'event_msg', payload: { type: 'item_completed', turn_id: turnA,
    item: { id, type, kind }, started_at_ms: start, completed_at_ms: end } });
  s.apply(item('tool-a', 'CommandExecution', 2000, 6000));
  s.apply(item('tool-b', 'McpToolCall', 4000, 8000));
  s.apply(item('tool-a', 'CommandExecution', 2000, 6000));
  s.apply(item('model-a', 'Reasoning', 4000, 5000));
  s.apply(item('model-b', 'AgentMessage', 6000, 7000));
  s.apply(item('web', 'Extension', 5000, 5500, 'web.search'));
  s.apply(item('outside', 'FileChange', 12000, 13000));
  s.apply({ type: 'event_msg', timestamp: new Date(11000).toISOString(), payload: { type: 'task_complete', turn_id: turnA, duration_ms: 10000 } });
  assert.equal(s.row(turnA).durationMs, 6000);
  assert.equal(s.row(turnA).speed, 100);
  // A late lifecycle completion only deducts its portion inside this turn.
  s.apply(item('late', 'ImageView', 10000, 12000));
  assert.equal(s.row(turnA).durationMs, 5000);
  assert.equal(s.row(turnA).speed, 120);
  s.apply(item('tool-a', 'CommandExecution', 2000, 6500));
  assert.equal(s.row(turnA).durationMs, null);
  assert.equal(s.row(turnA).turn.output, 600);
});

test('missing, reversed or unknown timing yields unknown duration and speed without losing tokens', () => {
  for (const payload of [null,
    { item: { id: 'bad', type: 'CommandExecution' }, started_at_ms: 3000, completed_at_ms: 2000 },
    { item: { id: 'new', type: 'Extension', kind: 'unknown' }, started_at_ms: 2000, completed_at_ms: 3000 },
  ]) {
    const s = new UsageState(thread); s.apply(header()); s.apply(event('task_started', turnA));
    s.apply(record(turnA, 'response', rawUsage(100, 80, 10)));
    if (payload) s.apply({ type: 'event_msg', payload: { type: 'item_completed', turn_id: turnA, ...payload } });
    s.apply({ type: 'event_msg', timestamp: new Date(11000).toISOString(), payload: { type: 'task_complete', turn_id: turnA, duration_ms: 10000 } });
    assert.equal(s.row(turnA).durationMs, null);
    assert.equal(s.row(turnA).speed, null);
    assert.equal(s.row(turnA).turn.total, 110);
  }
});

test('modern/legacy duplicate carriers do not double-count, equal responses with different IDs both count', () => {
  const s = new UsageState(thread); s.apply(header()); s.apply(event('task_started', turnA));
  const a = rawUsage(100, 80, 10);
  const first = record(turnA, 'resp_a', a);
  s.apply(first); s.apply(first);
  s.apply({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: a } } });
  s.apply(record(turnA, 'resp_b', a, rawUsage(200, 160, 20)));
  assert.equal(s.row(turnA), null, 'in-flight rounds are not presented as completed');
  s.apply(event('task_complete', turnA));
  assert.equal(s.row(turnA).turn.total, 220);
  assert.equal(s.row(turnA).cumulative.total, 220);
  assert.equal(s.duplicates, 1);
  s.apply(event('task_started', turnB));
  s.apply(record(turnB, 'resp_c', rawUsage(300, 30, 30), rawUsage(300, 30, 30), rawUsage(500, 190, 50)));
  s.apply(event('task_complete', turnB));
  const row = s.row(turnB);
  assert.equal(row.turn.total, 330);
  assert.equal(row.cumulative.total, 550);
  assert.equal(row.cumulative.cached / row.cumulative.input * 100, 38, 'weighted input ratio, not average of 80% and 10%');
  assert.equal(s.row(turnA).cumulative.total, 220, 'historical snapshot is immutable across later turns');
});

test('foreign thread, conflicting response and mislabeled turn snapshots fail closed', () => {
  const s = new UsageState(thread); s.apply(header()); s.apply(event('task_started', turnA));
  const a = rawUsage(100, 80, 10);
  const foreign = record(turnA, 'foreign', a); foreign.payload.thread_id = turnB; s.apply(foreign);
  assert.equal(s.latest, null);
  s.apply(record(turnA, 'same', a));
  s.apply(record(turnA, 'same', rawUsage(200, 80, 10)));
  s.apply(event('task_complete', turnA));
  assert.equal(s.row(turnA).turn, null);
  assert.equal(s.row(turnA).cumulative, null);
  const wrong = new UsageState(thread); wrong.apply(header()); wrong.apply(event('task_started', turnA));
  wrong.apply(record(turnA, 'r', a, rawUsage(999, 900, 10), a)); wrong.apply(event('task_complete', turnA));
  assert.equal(wrong.row(turnA).turn, null);
  assert.equal(wrong.row(turnA).cumulative.total, 110);
});

test('missing cache, zero input, legacy-only records, overflow and counter regression remain distinct from zero', () => {
  assert.equal(usage(rawUsage(1, 2, 1)), null);
  assert.equal(usage({ input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 1, total_tokens: Number.MAX_SAFE_INTEGER + 1 }), null);
  const missing = rawUsage(10, undefined, 2); delete missing.cached_input_tokens;
  assert.equal(usage(missing).cached, null);
  assert.equal(usage(rawUsage(0, 0, 0)).total, 0);
  const s = new UsageState(thread); s.apply(header()); s.apply(event('task_started', turnA));
  s.apply({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: rawUsage(20, 10, 2) } } });
  s.apply(event('task_complete', turnA));
  assert.equal(s.row(turnA).turn, null);
  assert.equal(s.row(turnA).cumulative.total, 22);
  s.apply(event('task_started', turnB)); s.apply(record(turnB, 'reset', rawUsage(5, 1, 1))); s.apply(event('task_complete', turnB));
  assert.equal(s.row(turnB).cumulative, null);
  assert.equal(s.row(turnA).cumulative.total, 22, 'later regression does not rewrite earlier snapshots');
});

test('malformed intervals taint active rounds and forked/incorrect headers cannot establish a session', () => {
  const s = new UsageState(thread); s.apply(header()); s.apply(event('task_started', turnA));
  s.apply(record(turnA, 'r', rawUsage(10, 5, 1))); s.invalidateActive('invalid-record-skipped'); s.apply(event('task_complete', turnA));
  assert.equal(s.row(turnA).turn, null);
  const fork = new UsageState(thread); const meta = header(); meta.payload.parent_thread_id = turnB; fork.apply(meta);
  fork.apply(event('task_started', turnA)); fork.apply(record(turnA, 'r', rawUsage(10, 5, 1))); fork.apply(event('task_complete', turnA));
  assert.equal(fork.row(turnA), null);
});

test('late conflicting responses invalidate stale snapshots and reused response IDs cannot count in another turn', () => {
  const s = new UsageState(thread); s.apply(header()); s.apply(event('task_started', turnA));
  s.apply(record(turnA, 'reused', rawUsage(100, 80, 10))); s.apply(event('task_complete', turnA));
  s.apply(event('task_started', turnB));
  s.apply(record(turnB, 'reused', rawUsage(100, 80, 10), rawUsage(100, 80, 10), rawUsage(200, 160, 20)));
  s.apply(event('task_complete', turnB));
  assert.equal(s.row(turnA).turn, null);
  assert.equal(s.row(turnA).cumulative, null);
  assert.equal(s.row(turnB).turn, null);
  assert.equal(s.row(turnB).cumulative, null);

  const late = new UsageState(thread); late.apply(header()); late.apply(event('task_started', turnA));
  late.apply(record(turnA, 'a', rawUsage(100, 80, 10))); late.apply(event('task_complete', turnA));
  late.apply(record(turnA, 'a', rawUsage(100, 80, 11)));
  assert.equal(late.row(turnA).turn, null);
  assert.equal(late.row(turnA).cumulative, null);
});

test('cache counter regression and invalid late usage never preserve a stale cumulative snapshot', () => {
  const s = new UsageState(thread); s.apply(header()); s.apply(event('task_started', turnA));
  s.apply(record(turnA, 'a', rawUsage(100, 80, 10))); s.apply(event('task_complete', turnA));
  s.apply(event('task_started', turnB));
  s.apply(record(turnB, 'b', rawUsage(100, 0, 10), rawUsage(100, 0, 10), rawUsage(200, 70, 20)));
  s.apply(event('task_complete', turnB));
  assert.equal(s.row(turnB).cumulative, null);
  assert.equal(s.row(turnA).cumulative.total, 110);
  s.apply(record(turnA, 'invalid', { input_tokens: 1, output_tokens: 1 }));
  assert.equal(s.row(turnA).cumulative, null);
});
