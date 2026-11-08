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
    this.latest = null;
    this.modernSeen = false;
    this.counterConflict = false;
    this.warningCounts = Object.create(null);
    this.duplicates = 0;
  }
  warn(key) { this.warningCounts[key] = (this.warningCounts[key] ?? 0) + 1; }
  invalidateActive(reason) {
    this.warn(reason);
    for (const turn of this.turns.values()) if (!turn.complete) turn.conflict = true;
    this.latest = null;
  }
  turn(id) {
    if (!isUuid(id)) return null;
    id = id.toLowerCase();
    if (!this.turns.has(id)) this.turns.set(id, { id, started: false, complete: false, responses: new Map(), candidate: null, conflict: false, cumulative: null,
      durationMs: null });
    return this.turns.get(id);
  }
  cumulative(snapshot) {
    if (!snapshot) { this.warn('invalid-cumulative'); this.latest = null; return; }
    if (this.latest && ['input', 'output', 'total'].some((k) => snapshot[k] < this.latest[k])) {
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
        this.warn('invalid-response-usage-or-id');
        return;
      }
      const previous = turn.responses.get(p.response_id);
      if (previous) {
        this.duplicates++;
        if (!equalUsage(previous, own)) { turn.conflict = true; this.latest = null; this.warn('conflicting-response-duplicate'); }
        return;
      }
      turn.responses.set(p.response_id, own);
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
    if (direct && attributed && direct.toLowerCase() !== attributed.toLowerCase()) { this.warn('ambiguous-turn-attribution'); return; }
    const turn = this.turn(direct ?? attributed);
    if (!turn) { this.warn('missing-task-turn-id'); return; }
    if (p.type === 'task_started') turn.started = true;
    if (p.type === 'task_complete' && !turn.complete) {
      turn.complete = true;
      turn.durationMs = count(p.duration_ms) ? p.duration_ms : null;
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
    const speed = own && turn.durationMs > 0 ? own.output * 1000 / turn.durationMs : null;
    return { turnId: turn.id, turn: own, cumulative: turn.cumulative,
      speed: Number.isFinite(speed) ? speed : null, durationMs: turn.durationMs };
  }
  snapshot(turnIds) {
    return { threadId: this.threadId, rows: turnIds.map((id) => this.row(id)).filter(Boolean) };
  }
}
