export function validateSocketUrl(value, port) {
  const u = new URL(value);
  if (u.protocol !== 'ws:' || u.hostname !== '127.0.0.1' || Number(u.port) !== port || u.username || u.password || u.search || u.hash || !/^\/devtools\/page\/[a-zA-Z0-9-]+$/.test(u.pathname)) {
    throw new Error('Rejected CDP target endpoint');
  }
  return u.href;
}

export function selectTarget(targets, port) {
  const matches = targets.filter((target) => {
    try {
      const u = new URL(target.url);
      return target.type === 'page' && u.protocol === 'app:' && u.pathname === '/index.html' && !u.searchParams.has('initialRoute');
    } catch { return false; }
  });
  if (matches.length !== 1) throw new Error('Codex main renderer is not unique; no injection');
  return validateSocketUrl(matches[0].webSocketDebuggerUrl, port);
}

export async function connect(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { redirect: 'error', signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error('CDP discovery failed');
  const body = await response.text();
  if (body.length > 1024 * 1024) throw new Error('CDP discovery too large');
  const socket = new WebSocket(selectTarget(JSON.parse(body), port));
  const pending = new Map();
  let sequence = 0;
  const fail = () => {
    for (const { reject } of pending.values()) reject(new Error('CDP disconnected'));
    pending.clear();
  };
  socket.addEventListener('close', fail);
  socket.addEventListener('error', fail);
  socket.addEventListener('message', ({ data }) => {
    let msg;
    try { msg = JSON.parse(data); }
    catch { fail(); socket.close(); return; }
    const request = pending.get(msg.id);
    if (!request) return; // Unsolicited events are neither inspected nor saved.
    pending.delete(msg.id);
    if (msg.error || msg.result?.exceptionDetails) request.reject(new Error('CDP evaluation failed'));
    else request.resolve(msg.result?.result?.value);
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('CDP connect timeout')); }, 3000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connect failed')); }, { once: true });
  });
  return {
    async evaluate(expression) {
      if (socket.readyState !== WebSocket.OPEN) throw new Error('CDP disconnected');
      const id = ++sequence;
      let timer;
      try {
        return await new Promise((resolve, reject) => {
          timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP command timeout')); }, 3000);
          pending.set(id, { resolve, reject });
          socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
        });
      } finally { clearTimeout(timer); }
    },
    close() { socket.close(); },
  };
}
