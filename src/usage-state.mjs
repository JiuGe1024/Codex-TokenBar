export const isUuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const count = (value) => Number.isSafeInteger(value) && value >= 0;

export function usage(value) {
  if (!value || !count(value.input_tokens) || !count(value.output_tokens) || !count(value.total_tokens)
    || !Number.isSafeInteger(value.input_tokens + value.output_tokens)
    || value.input_tokens + value.output_tokens !== value.total_tokens) return null;
  const cached = value.cached_input_tokens;
  if (cached != null && (!count(cached) || cached > value.input_tokens)) return null;
  return { input: value.input_tokens, output: value.output_tokens, total: value.total_tokens, cached: cached ?? null };
}

const equalUsage = (a, b) => a && b && ['input', 'output', 'total', 'cached'].every((key) => a[key] === b[key]);
const modelItems = new Set(['Reasoning', 'AgentMessage', 'Plan']);
const toolItems = new Set(['CommandExecution', 'FileChange', 'McpToolCall', 'WebSearch', 'ImageView', 'DynamicToolCall', 'CollabAgentToolCall', 'ImageGeneration']);
function unionIntervals(intervals) {
  const merged = [];
  for (const interval of intervals.sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]);
    else merged.push([...interval]);
  }
  return merged;
}
function durationWithoutTools(turn) {
  if (!count(turn.durationMs) || !count(turn.completedAtMs) || turn.timingInvalid || !turn.items.size) return null;
  const start = turn.completedAtMs - turn.durationMs;
  if (!count(start)) return null;
  const tools = [], models = [];
  for (const item of turn.items.values()) {
    const interval = [Math.max(start, item.start), Math.min(turn.completedAtMs, item.end)];
    if (interval[1] > interval[0]) (item.tool ? tools : models).push(interval);
  }
  const toolUnion = unionIntervals(tools), modelUnion = unionIntervals(models);
  let toolMs = toolUnion.reduce((sum, [a, b]) => sum + b - a, 0);
  // Preserve observed model activity that overlaps tools. Parallel tools and
  // repeated lifecycle notifications must never subtract the same time twice.
  let modelIndex = 0;
  for (const [a, b] of toolUnion) {
    while (modelIndex < modelUnion.length && modelUnion[modelIndex][1] <= a) modelIndex++;
    for (let i = modelIndex; i < modelUnion.length && modelUnion[i][0] < b; i++) {
      toolMs -= Math.max(0, Math.min(b, modelUnion[i][1]) - Math.max(a, modelUnion[i][0]));
    }
  }
  return turn.durationMs - toolMs;
}
function sumUsage(values) {
  const total = { input: 0, output: 0, total: 0, cached: 0 };
  for (const item of values) {
    for (const key of Object.keys(total)) {
      if (total[key] === null || item[key] === null) total[key] = null;
      else {
        total[key] += item[key];
        if (!count(total[key])) return null;
      }
    }
  }
  return total;
}

export class UsageState {
  constructor(threadId) {
    if (!isUuid(threadId)) throw new Error('Invalid thread ID');
    this.threadId = threadId.toLowerCase();
    this.headerValid = false;
    this.turns = new Map();
    this.responseTurns = new Map();
    this.latest = null;
    this.modernSeen = false;
    this.counterConflict = false;
    this.warningCounts = Object.create(null);
    this.duplicates = 0;
  }
  warn(key) { this.warningCounts[key] = (this.warningCounts[key] ?? 0) + 1; }
  invalidateActive(reason) {
    this.warn(reason);
    for (const turn of this.turns.values()) if (!turn.complete) { turn.conflict = true; turn.timingInvalid = true; }
    this.latest = null;
  }
  turn(id) {
    if (!isUuid(id)) return null;
    id = id.toLowerCase();
    if (!this.turns.has(id)) this.turns.set(id, { id, started: false, complete: false, responses: new Map(), candidate: null, conflict: false, cumulative: null,
      durationMs: null, completedAtMs: null, items: new Map(), timingInvalid: false });
    return this.turns.get(id);
  }
  cumulative(snapshot) {
    if (!snapshot) { this.warn('invalid-cumulative'); this.latest = null; return; }
    if (this.latest && (['input', 'output', 'total'].some((k) => snapshot[k] < this.latest[k])
      || (snapshot.cached !== null && this.latest.cached !== null && snapshot.cached < this.latest.cached))) {
      this.counterConflict = true;
      this.warn('cumulative-reset-or-regression');
    }
    this.latest = snapshot;
  }
  apply(row) {
    if (!row) return;
    const p = row.payload;
    if (row.type === 'session_meta') {
      this.headerValid = p.id?.toLowerCase() === this.threadId && p.parent_thread_id == null;
      if (!this.headerValid) this.warn('session-identity-or-parent-unsupported');
      return;
    }
    if (!this.headerValid) return;
    if (row.type === 'token_usage_record') {
      if (p.thread_id?.toLowerCase() !== this.threadId) { this.warn('foreign-thread-ignored'); return; }
      const turn = this.turn(p.turn_id);
      if (!turn) { this.warn('missing-turn-id'); return; }
      const own = usage(p.usage);
      const cumulative = usage(p.thread_token_usage);
      const candidate = usage(p.turn_token_usage);
      if (!own || typeof p.response_id !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(p.response_id)) {
        turn.conflict = true;
        turn.cumulative = null;
        this.latest = null;
        this.warn('invalid-response-usage-or-id');
        return;
      }
      const owner = this.responseTurns.get(p.response_id);
      if (owner && owner !== turn) {
        owner.conflict = turn.conflict = true;
        owner.cumulative = turn.cumulative = this.latest = null;
        this.warn('response-id-reused-across-turns');
        return;
      }
      const previous = turn.responses.get(p.response_id);
      if (previous) {
        this.duplicates++;
        if (!equalUsage(previous, own)) { turn.conflict = true; turn.cumulative = this.latest = null; this.warn('conflicting-response-duplicate'); }
        return;
      }
      turn.responses.set(p.response_id, own);
      this.responseTurns.set(p.response_id, turn);
      turn.candidate = candidate;
      this.modernSeen = true;
      this.cumulative(cumulative);
      if (turn.complete) turn.cumulative = this.counterConflict ? null : this.latest;
      return;
    }
    if (p.type === 'token_count') {
      // This carrier repeats modern usage; it is never added to modern totals.
      // Without response IDs it also cannot establish per-turn deduplication.
      if (!this.modernSeen) this.cumulative(usage(p.info?.total_token_usage));
      return;
    }
    const direct = p.turn_id;
    const attributed = p.turn_attribution?.turn_id;
    if (direct && attributed && direct.toLowerCase() !== attributed.toLowerCase()) {
      if (p.type === 'item_completed') for (const id of [direct, attributed]) {
        const affected = this.turns.get(id.toLowerCase());
        if (affected) affected.timingInvalid = true;
      }
      this.warn('ambiguous-turn-attribution');
      return;
    }
    const turn = this.turn(direct ?? attributed);
    if (!turn) { this.warn('missing-task-turn-id'); return; }
    if (p.type === 'item_completed') {
      if (p.item?.type === 'UserMessage') return;
      const tool = toolItems.has(p.item?.type) || (p.item?.type === 'Extension' && p.item.kind === 'web.search');
      const known = tool || modelItems.has(p.item?.type);
      const id = p.item?.id, start = p.started_at_ms, end = p.completed_at_ms;
      if (!known || typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(id) || !count(start) || !count(end) || end < start) {
        if (!turn.timingInvalid) this.warn('unknown-or-invalid-item-timing');
        turn.timingInvalid = true;
        return;
      }
      const previous = turn.items.get(id);
      if (previous && (previous.start !== start || previous.end !== end || previous.tool !== tool)) {
        turn.timingInvalid = true;
        this.warn('conflicting-item-timing');
      } else turn.items.set(id, { start, end, tool });
      return;
    }
    if (p.type === 'task_started') turn.started = true;
    if (p.type === 'task_complete' && !turn.complete) {
      turn.complete = true;
      turn.durationMs = count(p.duration_ms) ? p.duration_ms : null;
      turn.completedAtMs = typeof row.timestamp === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(row.timestamp) ? Date.parse(row.timestamp) : null;
      turn.cumulative = this.counterConflict ? null : this.latest;
    }
  }
  row(turnId) {
    const turn = this.turns.get(turnId?.toLowerCase());
    if (!this.headerValid || !turn?.complete) return null;
    const sum = sumUsage(turn.responses.values());
    // Cross-check per-response official numbers with the explicit turn snapshot.
    // Never trust a mislabeled cumulative snapshot as if it described one turn.
    const totalsMatch = sum && turn.candidate && ['input', 'output', 'total'].every((k) => sum[k] === turn.candidate[k]);
    const cacheMatches = sum?.cached == null || turn.candidate?.cached == null || sum.cached === turn.candidate.cached;
    const valid = turn.started && turn.responses.size > 0 && !turn.conflict && totalsMatch && cacheMatches;
    const own = valid ? { ...sum, cached: sum.cached === null || turn.candidate.cached === null ? null : sum.cached } : null;
    const durationMs = durationWithoutTools(turn);
    const speed = own && durationMs > 0 ? own.output * 1000 / durationMs : null;
    return { turnId: turn.id, turn: own, cumulative: turn.cumulative,
      speed: Number.isFinite(speed) ? speed : null, durationMs };
  }
  snapshot(turnIds) {
    return { threadId: this.threadId, rows: turnIds.map((id) => this.row(id)).filter(Boolean) };
  }
}
