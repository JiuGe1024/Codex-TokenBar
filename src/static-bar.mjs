// Stage 1 only: no usage reader, network, storage, account calls or telemetry.
export function inspectLayout() {
  const visible = (node) => {
    if (node.closest('[data-app-shell-active-page="false"], [aria-hidden="true"], [inert]')) return false;
    const r = node.getBoundingClientRect();
    const s = getComputedStyle(node);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const summary = (node) => {
    const r = node.getBoundingClientRect();
    const s = getComputedStyle(node);
    return {
      tag: node.tagName, classes: [...node.classList].slice(0, 12),
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      display: s.display, flexDirection: s.flexDirection,
      overflowX: s.overflowX, overflowY: s.overflowY,
    };
  };
  const selectors = ['[data-local-conversation-final-assistant]', '[data-turn-key]', '[data-content-search-turn-key]'];
  return {
    devicePixelRatio,
    viewport: { width: innerWidth, height: innerHeight },
    candidates: selectors.map((selector) => ({
      selector,
      nodes: [...document.querySelectorAll(selector)].filter(visible).slice(-8).map((node) => ({
        ...summary(node),
        turnKey: node.closest('[data-turn-key]')?.getAttribute('data-turn-key') ?? null,
        contentTurnKey: node.closest('[data-content-search-turn-key]')?.getAttribute('data-content-search-turn-key') ?? null,
        finalAssistant: node.hasAttribute('data-local-conversation-final-assistant'),
        parent: node.parentElement ? summary(node.parentElement) : null,
      })),
    })),
  };
}

// The selector MUST come from a separately inspected live DOM report.
// No fallback guessing and no edits to native elements or their styles.
export function mountStaticBar(selector) {
  const key = '__codexTokenBarProbe';
  if (window[key] || document.getElementById('codex-tokenbar-probe')) return { ok: false, reason: 'already-mounted' };
  const candidates = [...document.querySelectorAll(selector)].filter((node) => {
    if (node.closest('[data-app-shell-active-page="false"], [aria-hidden="true"], [inert]')) return false;
    const r = node.getBoundingClientRect();
    const s = getComputedStyle(node);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  });
  if (candidates.length !== 1) return { ok: false, reason: 'anchor-not-unique' };
  const anchor = candidates[0];
  if (!anchor.hasAttribute('data-local-conversation-final-assistant')) return { ok: false, reason: 'not-final-assistant' };
  const parent = anchor;
  const layout = getComputedStyle(anchor);
  if (!(layout.display === 'block' || (layout.display === 'flex' && layout.flexDirection === 'column'))) {
    return { ok: false, reason: 'unsupported-parent-layout' };
  }
  const host = document.createElement('div');
  host.id = 'codex-tokenbar-probe';
  host.setAttribute('data-tokenbar-owned', 'probe');
  host.style.cssText = 'display:block;position:static;flex:0 0 auto;min-width:0;width:100%;box-sizing:border-box';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host { color:var(--color-text-secondary,var(--text-secondary,inherit)); font:inherit; }
    .bar { display:flex; flex-wrap:wrap; align-items:center; justify-content:flex-start;
      gap:2px 12px; box-sizing:border-box; min-height:24px; padding:4px 0;
      font-size:11px; line-height:20px; font-variant-numeric:tabular-nums; }
    button { color:inherit; background:transparent; border:0; border-radius:4px;
      font:inherit; cursor:pointer; padding:0 4px; }
    button:focus-visible { outline:2px solid currentColor; outline-offset:1px; }
  </style><div class="bar" role="status" aria-label="TokenBar 静态验证，尚未连接统计数据">
    <span>本轮 -- tok</span><span>缓存 --%</span>
    <span>本对话累计 -- tok</span><span>累计缓存 --%</span>
    <button type="button" aria-label="关闭 TokenBar 静态验证">×</button>
  </div>`;
  let observer;
  let lease;
  const stop = () => {
    observer?.disconnect();
    clearTimeout(lease);
    host.remove();
    delete window[key];
    return { ok: true, removed: true };
  };
  const nativeChildren = [...anchor.children];
  anchor.append(host);
  const h = host.getBoundingClientRect();
  const p = parent.getBoundingClientRect();
  const nativeBottom = Math.max(p.top, ...nativeChildren.map((node) => node.getBoundingClientRect().bottom));
  if (h.width <= 0 || h.height < 20 || h.top < nativeBottom - 1 || h.left < p.left - 1 || h.right > p.right + 1 || h.bottom > p.bottom + 1 || h.bottom > innerHeight) {
    stop();
    return { ok: false, reason: 'layout-check-failed' };
  }
  shadow.querySelector('button').addEventListener('click', stop);
  // First-stage behavior is intentionally fail-closed on native re-render.
  observer = new MutationObserver(() => {
    if (!anchor.isConnected || host.parentElement !== parent || anchor.lastElementChild !== host || anchor.closest('[data-app-shell-active-page="false"], [aria-hidden="true"], [inert]')) stop();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-app-shell-active-page', 'aria-hidden', 'inert'] });
  const renew = () => { clearTimeout(lease); lease = setTimeout(stop, 10000); return { ok: true }; };
  window[key] = { stop, renew };
  renew();
  return { ok: true, position: getComputedStyle(host).position, normalFlow: true };
}
