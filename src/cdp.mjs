const cdpError = (code, message) => Object.assign(new Error(message), { code });

export function validateSocketUrl(value, port) {
  const u = new URL(value);
  if (u.protocol !== 'ws:' || u.hostname !== '127.0.0.1' || Number(u.port) !== port || u.username || u.password || u.search || u.hash || !/^\/devtools\/page\/[a-zA-Z0-9-]+$/.test(u.pathname)) {
    throw cdpError('CDP_TARGET_REJECTED', 'Rejected CDP target endpoint');
  }
  return u.href;
}

export function selectTarget(targets, port) {
  if (!Array.isArray(targets)) throw cdpError('CDP_TARGET_REJECTED', 'Invalid CDP target list');
  const matches = targets.filter((target) => {
    try {
      const u = new URL(target.url);
      return target.type === 'page' && u.protocol === 'app:' && u.hostname === '-' && u.pathname === '/index.html' && !u.searchParams.has('initialRoute');
    } catch { return false; }
  });
  if (!matches.length) throw cdpError('CDP_TARGET_UNAVAILABLE', 'Codex main renderer is unavailable');
  if (matches.length !== 1) throw cdpError('CDP_TARGET_REJECTED', 'Codex main renderer is not unique; no injection');
  return validateSocketUrl(matches[0].webSocketDebuggerUrl, port);
}

export async function connect(port) {
  let body;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { redirect: 'error', signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error('Discovery status rejected');
    body = await response.text();
  } catch { throw cdpError('CDP_TRANSPORT', 'CDP discovery failed'); }
  if (body.length > 1024 * 1024) throw new Error('CDP discovery too large');
  const socket = new WebSocket(selectTarget(JSON.parse(body), port));
  const pending = new Map();
  let sequence = 0;
  const fail = (error = cdpError('CDP_TRANSPORT', 'CDP disconnected')) => {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };
  socket.addEventListener('close', () => fail());
  socket.addEventListener('error', () => fail());
  socket.addEventListener('message', ({ data }) => {
    let msg;
    try { msg = JSON.parse(data); }
    catch { fail(cdpError('CDP_PROTOCOL_ERROR', 'Invalid CDP response')); socket.close(); return; }
    if (!msg || typeof msg !== 'object') { fail(cdpError('CDP_PROTOCOL_ERROR', 'Invalid CDP response')); socket.close(); return; }
    const request = pending.get(msg.id);
    if (!request) return; // Unsolicited events are neither inspected nor saved.
    pending.delete(msg.id);
    if (msg.error || msg.result?.exceptionDetails) request.reject(cdpError('CDP_EVALUATION', 'CDP evaluation failed'));
    else request.resolve(msg.result?.result?.value);
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(cdpError('CDP_TRANSPORT', 'CDP connect timeout')); }, 3000);
      const opened = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(cdpError('CDP_TRANSPORT', 'CDP connect failed')); };
      function cleanup() {
        clearTimeout(timer);
        socket.removeEventListener('open', opened);
        socket.removeEventListener('error', failed);
        socket.removeEventListener('close', failed);
      }
      socket.addEventListener('open', opened, { once: true });
      socket.addEventListener('error', failed, { once: true });
      socket.addEventListener('close', failed, { once: true });
    });
  } catch (error) { socket.close(); throw error; }
  return {
    async evaluate(expression) {
      if (socket.readyState !== WebSocket.OPEN) throw cdpError('CDP_TRANSPORT', 'CDP disconnected');
      const id = ++sequence;
      let timer;
      try {
        return await new Promise((resolve, reject) => {
          timer = setTimeout(() => { pending.delete(id); reject(cdpError('CDP_TRANSPORT', 'CDP command timeout')); }, 3000);
          pending.set(id, { resolve, reject });
          try { socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } })); }
          catch { pending.delete(id); reject(cdpError('CDP_TRANSPORT', 'CDP send failed')); }
        });
      } finally { clearTimeout(timer); }
    },
    close() { fail(); socket.close(); },
  };
}
