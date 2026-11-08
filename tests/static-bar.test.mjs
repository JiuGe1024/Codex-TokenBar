import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountStaticBar } from '../src/static-bar.mjs';

// Synthetic geometry tests exercise fail-closed behavior; they do NOT prove
// native Codex layout, rendering, DPI or keyboard compatibility.
function fixture(body = '<main><section data-anchor data-local-conversation-final-assistant style="display:flex;flex-direction:column"><p></p></section></main>') {
  const dom = new JSDOM(body, { runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    const top = this.id === 'codex-tokenbar-probe' ? 100 : 0;
    const height = this.tagName === 'MAIN' || this.hasAttribute('data-local-conversation-final-assistant') ? 160 : this.id === 'codex-tokenbar-probe' ? 24 : 100;
    return { x: 0, y: top, top, left: 0, width: 500, height, right: 500, bottom: top + height };
  };
  const mount = () => dom.window.eval(`(${mountStaticBar})('[data-anchor]')`);
  return { dom, mount, document: dom.window.document };
}

test('static bar follows a final reply in normal flow and leaves native DOM/style unchanged after closing', () => {
  const { dom, mount, document } = fixture();
  try {
    const original = document.body.innerHTML;
    assert.equal(mount().ok, true);
    const anchor = document.querySelector('[data-anchor]');
    const host = document.getElementById('codex-tokenbar-probe');
    assert.equal(anchor.lastElementChild, host);
    assert.equal(host.style.position, 'static');
    assert.equal(host.shadowRoot.querySelectorAll('span').length, 4);
    assert.equal(mount().reason, 'already-mounted');
    host.shadowRoot.querySelector('button').click();
    assert.equal(document.body.innerHTML, original);
    assert.equal(dom.window.__codexTokenBarProbe, undefined);
  } finally { dom.window.close(); }
});

test('ambiguous anchors, row-flex layout and non-final messages stop without inserting anything', () => {
  for (const body of [
    '<main><section data-anchor data-local-conversation-final-assistant></section><section data-anchor data-local-conversation-final-assistant></section></main>',
    '<main><section data-anchor data-local-conversation-final-assistant style="display:flex;flex-direction:row"></section></main>',
    '<main style="display:block"><section data-anchor></section></main>',
  ]) {
    const { dom, mount, document } = fixture(body);
    try {
      const original = document.body.innerHTML;
      assert.equal(mount().ok, false);
      assert.equal(document.body.innerHTML, original);
    } finally { dom.window.close(); }
  }
});

test('native rerender or page deactivation removes probe safely', async () => {
  for (const action of ['remove', 'deactivate']) {
    const { dom, mount, document } = fixture();
    try {
      assert.equal(mount().ok, true);
      const anchor = document.querySelector('[data-anchor]');
      if (action === 'remove') anchor.remove();
      else anchor.setAttribute('data-app-shell-active-page', 'false');
      await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
      assert.equal(document.getElementById('codex-tokenbar-probe'), null);
      assert.equal(dom.window.__codexTokenBarProbe, undefined);
    } finally { dom.window.close(); }
  }
});
