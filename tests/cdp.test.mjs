import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectTarget, validateSocketUrl } from '../src/cdp.mjs';

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
});
