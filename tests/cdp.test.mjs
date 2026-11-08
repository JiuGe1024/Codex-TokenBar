import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect, selectTarget, validateSocketUrl } from '../src/cdp.mjs';

test('CDP endpoint accepts only the verified IPv4 loopback page target', () => {
  const good = 'ws://127.0.0.1:9337/devtools/page/ABC-123';
  assert.equal(validateSocketUrl(good, 9337), good);
  for (const bad of [
    'ws://192.168.1.2:9337/devtools/page/ABC',
    'ws://localhost:9337/devtools/page/ABC',
    'ws://127.0.0.1:9222/devtools/page/ABC',
    'ws://user:secret@127.0.0.1:9337/devtools/page/ABC',
    'ws://127.0.0.1:9337/devtools/browser/ABC',
    good + '?redirect=elsewhere',
  ]) assert.throws(() => validateSocketUrl(bad, 9337));
});

test('renderer selection rejects ambiguity and ignores auxiliary or web pages', () => {
  const main = { type: 'page', url: 'app://-/index.html', webSocketDebuggerUrl: 'ws://127.0.0.1:9337/devtools/page/ABC' };
  assert.equal(selectTarget([main, { ...main, url: 'app://-/index.html?initialRoute=/settings' }, { ...main, url: 'https://example.com/index.html' }], 9337), main.webSocketDebuggerUrl);
  assert.throws(() => selectTarget([], 9337));
  assert.throws(() => selectTarget([main, main], 9337));
  assert.throws(() => selectTarget([{ ...main, url: 'app://foreign/index.html' }], 9337));
  assert.throws(() => selectTarget({}, 9337));
});

test('transport close rejects pending evaluations; malformed frames and page errors stay distinct', async () => {
  const fetchBefore = globalThis.fetch, socketBefore = globalThis.WebSocket;
  let socket;
  try {
    globalThis.fetch = async () => ({ ok: true, text: async () => JSON.stringify([{ type: 'page', url: 'app://-/index.html', webSocketDebuggerUrl: 'ws://127.0.0.1:9337/devtools/page/TEST' }]) });
    globalThis.WebSocket = class extends EventTarget {
      static OPEN = 1;
      readyState = 1;
      constructor() { super(); socket = this; queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
      send(data) { this.last = JSON.parse(data); }
      close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
    };
    let session = await connect(9337);
    const closed = assert.rejects(session.evaluate('true'), { code: 'CDP_TRANSPORT' });
    session.close();
    await closed;
    session = await connect(9337);
    const malformed = assert.rejects(session.evaluate('true'), { code: 'CDP_PROTOCOL_ERROR' });
    socket.dispatchEvent(new MessageEvent('message', { data: 'null' }));
    await malformed;
    session = await connect(9337);
    const evaluation = assert.rejects(session.evaluate('true'), { code: 'CDP_EVALUATION' });
    socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id: socket.last.id, result: { exceptionDetails: {} } }) }));
    await evaluation;
    session.close();
  } finally { globalThis.fetch = fetchBefore; globalThis.WebSocket = socketBefore; }
});
