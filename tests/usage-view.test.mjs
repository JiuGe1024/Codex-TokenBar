import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { pageContext, installUsageView } from '../src/usage-view.mjs';

const thread = '00000000-0000-0000-0000-000000000001';
const turn = '00000000-0000-0000-0000-000000000002';
const other = '00000000-0000-0000-0000-000000000003';
function fixture() {
  const dom = new JSDOM(`<main data-app-shell-active-page="true"><div data-above-composer-conversation-id="${thread}"></div><section data-turn-key="history-content:turn:${turn}" data-content-search-turn-key="${turn}"><div data-local-conversation-final-assistant style="display:flex;flex-direction:column"><p>Native content</p><button>Native action</button></div></section></main>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  dom.window.HTMLElement.prototype.showPopover = function () {};
  dom.window.HTMLElement.prototype.hidePopover = function () {};
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    const owned = this.dataset.tokenbarOwned === 'usage';
    const anchor = this.hasAttribute('data-local-conversation-final-assistant');
    const top = owned || this.classList.contains('bar') ? 200 : this.tagName === 'BUTTON' ? 174 : 20;
    const height = owned ? 28 : anchor ? 180 + (this.querySelector('[data-tokenbar-owned]') ? 28 : 0) : this.tagName === 'BUTTON' ? 26 : 130;
    return { x: 0, y: top, top, left: 0, width: 500, height, right: 500, bottom: top + height };
  };
  dom.window.eval(`(${installUsageView})(${pageContext})`);
  const update = (row = { turn: { input: 200, cached: 160, output: 20, total: 220 }, cumulative: { input: 500, cached: 190, output: 50, total: 550 } }) => dom.window.__codexTokenBar.update({ threadId: thread, rows: [{ turnId: turn, ...row }] });
  const settle = () => new Promise((resolve) => dom.window.setTimeout(resolve, 100));
  return { dom, document: dom.window.document, update, settle };
}

test('view displays metrics without trailing controls and stop removes owned UI', () => {
  const { dom, document, update } = fixture();
  try {
    const original = document.body.innerHTML;
    assert.equal(update().mountedRows, 1);
    const host = document.querySelector('[data-tokenbar-owned]');
    assert.deepEqual([...host.shadowRoot.querySelectorAll('span')].map((n) => n.textContent), ['本轮 0.22k', '缓存 80.00%', '本对话累计 0.55k', '累计缓存 38.00%']);
    assert.match(host.shadowRoot.querySelector('span').title, /220 Token/);
    assert.equal(host.shadowRoot.querySelectorAll('button').length, 1);
    assert.equal(host.shadowRoot.querySelector('.close'), null);
    assert.equal(host.shadowRoot.querySelector('style').textContent.includes('::after'), false);
    dom.window.__codexTokenBar.stop();
    assert.equal(document.body.innerHTML, original);
    assert.equal(dom.window.__codexTokenBarDisabled, true);
  } finally { dom.window.close(); }
});

test('per-turn details toggle independently, survive updates and show missing timing as unknown', () => {
  const { dom, document, update } = fixture();
  try {
    update();
    const root = document.querySelector('[data-tokenbar-owned]').shadowRoot;
    const toggle = root.querySelector('.toggle');
    const panel = root.querySelector('.panel');
    assert.equal(panel.querySelector('.hint'), null);
    const host = document.querySelector('[data-tokenbar-owned]');
    const height = host.getBoundingClientRect().height;
    assert.equal(panel.hidden, true);
    toggle.click();
    assert.equal(panel.hidden, false);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(panel.getAttribute('popover'), 'auto');
    assert.equal(parseFloat(panel.style.top) + panel.getBoundingClientRect().height, 192);
    assert.equal(host.getBoundingClientRect().height, height);
    assert.deepEqual([...panel.querySelectorAll('dd')].map(n => n.textContent), ['200', '20', '--', '--']);
    update({ turn: { input: 1234, output: 309, total: 1543, cached: 1000 }, cumulative: null, speed: 39.6, durationMs: 7800 });
    assert.equal(panel.hidden, false);
    assert.deepEqual([...panel.querySelectorAll('dd')].map(n => n.textContent), ['1,234', '309', '39.6 tok/s', '7.8 s']);
    assert.equal(panel.textContent.includes('上下文'), false);
    toggle.click();
    assert.equal(panel.hidden, true);
    toggle.click();
    const dismissal = new dom.window.Event('toggle');
    dismissal.newState = 'closed';
    panel.dispatchEvent(dismissal);
    assert.equal(panel.hidden, true);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  } finally { dom.window.close(); }
});

test('missing or zero-input data shows unknown cache, not a fabricated zero percent', () => {
  const { dom, document, update } = fixture();
  try {
    update({ turn: { input: 0, output: 0, total: 0, cached: 0 }, cumulative: null });
    assert.deepEqual([...document.querySelector('[data-tokenbar-owned]').shadowRoot.querySelectorAll('span')].map((n) => n.textContent), ['本轮 0.00k', '缓存 --', '本对话累计 --', '累计缓存 --']);
    update({ turn: { input: 3, output: 2, total: 5, cached: 0 }, cumulative: null });
    assert.equal(document.querySelector('[data-tokenbar-owned]').shadowRoot.querySelector('span').textContent, '本轮 <0.01k');
  } finally { dom.window.close(); }
});

test('virtualized native replacement remounts by turn ID, ambiguous nodes and session switches clear stats', async () => {
  const { dom, document, update, settle } = fixture();
  try {
    update();
    const anchor = document.querySelector('[data-local-conversation-final-assistant]');
    const replacement = anchor.cloneNode(true); replacement.querySelector('[data-tokenbar-owned]').remove();
    anchor.replaceWith(replacement); await settle();
    assert.equal(document.querySelectorAll('[data-tokenbar-owned]').length, 1);
    const duplicate = replacement.cloneNode(true); duplicate.querySelector('[data-tokenbar-owned]').remove();
    replacement.after(duplicate); await settle();
    assert.equal(document.querySelectorAll('[data-tokenbar-owned]').length, 0);
    duplicate.remove(); await settle(); assert.equal(document.querySelectorAll('[data-tokenbar-owned]').length, 1);
    document.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id', other);
    await settle(); assert.equal(document.querySelectorAll('[data-tokenbar-owned]').length, 0);
  } finally { dom.window.close(); }
});

test('ordinary ChatGPT pages and contradictory turn identifiers never receive stats', () => {
  const { dom, document, update } = fixture();
  try {
    document.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id', 'chatgpt:local-chatgpt:'+other);
    assert.equal(update().mountedRows, 0);
    document.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id', thread);
    document.querySelector('[data-turn-key]').setAttribute('data-turn-key', 'history-content:turn:'+other);
    assert.equal(update().mountedRows, 0);
  } finally { dom.window.close(); }
});
