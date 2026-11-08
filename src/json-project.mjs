// Decode only explicitly selected primitive fields. Unknown strings and values
// are scanned for structure, never deserialized into message/tool objects.
export function projectJson(source, selection) {
  let at = 0;
  const numberPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const fail = () => { throw new Error('Invalid or unsupported JSON record'); };
  const whitespace = () => { while (at < source.length && ' \t\r\n'.includes(source[at])) at++; };
  function string(decode) {
    const start = at;
    if (source[at++] !== '"') fail();
    while (at < source.length) {
      const c = source.charCodeAt(at++);
      if (c === 34) {
        if (decode && at - start > 512) fail();
        return decode ? JSON.parse(source.slice(start, at)) : undefined;
      }
      if (c < 32) fail();
      if (c === 92) {
        const escape = source[at++];
        if (escape === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(source.slice(at, at + 4))) fail();
          at += 4;
        } else if (!'"\\/bfnrt'.includes(escape ?? '\0')) fail();
      }
    }
    fail();
  }
  function value(spec, depth) {
    if (depth > 80) fail();
    whitespace();
    const c = source[at];
    if (c === '{') {
      at++;
      const selected = spec && spec !== true ? spec : null;
      const result = selected ? Object.create(null) : undefined;
      whitespace();
      if (source[at] === '}') { at++; return result; }
      for (;;) {
        whitespace();
        const keyStart = at;
        // Only selected object levels need property names. Whole unknown
        // subtrees, including message content, do not allocate even their keys.
        const key = string(Boolean(selected));
        if (selected && at - keyStart > 256) fail();
        whitespace();
        if (source[at++] !== ':') fail();
        const child = selected && Object.hasOwn(selected, key) ? selected[key] : null;
        const item = value(child, depth + 1);
        if (child) {
          if (Object.hasOwn(result, key)) fail();
          result[key] = item;
        }
        whitespace();
        const delimiter = source[at++];
        if (delimiter === '}') return result;
        if (delimiter !== ',') fail();
      }
    }
    if (c === '[') {
      at++;
      whitespace();
      if (source[at] === ']') { at++; return undefined; }
      for (;;) {
        value(null, depth + 1);
        whitespace();
        const delimiter = source[at++];
        if (delimiter === ']') return undefined;
        if (delimiter !== ',') fail();
      }
    }
    if (c === '"') return string(spec === true);
    for (const literal of ['true', 'false', 'null']) {
      if (source.startsWith(literal, at)) {
        at += literal.length;
        return spec === true ? JSON.parse(literal) : undefined;
      }
    }
    numberPattern.lastIndex = at;
    const number = numberPattern.exec(source);
    if (!number) fail();
    at += number[0].length;
    return spec === true ? Number(number[0]) : undefined;
  }
  const projected = value(selection, 0);
  whitespace();
  if (at !== source.length) fail();
  return projected;
}

export const usageFields = Object.freeze({ input_tokens: true, cached_input_tokens: true, output_tokens: true, total_tokens: true });
const attribution = { turn_id: true, root_turn_id: true };
export function projectUsageRecord(line) {
  const kind = projectJson(line, { type: true, payload: { type: true } });
  if (kind.type === 'session_meta') return projectJson(line, { type: true, payload: { id: true, parent_thread_id: true } });
  if (kind.type === 'token_usage_record') return projectJson(line, {
    type: true, ordinal: true,
    payload: { thread_id: true, turn_id: true, root_turn_id: true, response_id: true,
      usage: usageFields, turn_token_usage: usageFields, thread_token_usage: usageFields },
  });
  if (kind.type !== 'event_msg' || !['task_started', 'task_complete', 'token_count', 'item_completed'].includes(kind.payload?.type)) return null;
  return projectJson(line, { type: true, ordinal: true, timestamp: true, payload: {
    type: true, turn_id: true, turn_attribution: attribution,
    duration_ms: true, started_at_ms: true, completed_at_ms: true, item: { id: true, type: true, kind: true },
    info: { total_token_usage: usageFields },
  } });
}
