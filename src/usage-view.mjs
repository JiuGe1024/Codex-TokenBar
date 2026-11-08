// Serialized into the verified renderer. Read identifiers only; never text,
// input values, React internals, cookies or storage.
export function pageContext() {
  const hidden = '[data-app-shell-active-page="false"], [aria-hidden="true"], [inert]';
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const markers = [...document.querySelectorAll('[data-above-composer-conversation-id]')]
    .filter((n) => !n.closest(hidden)).map((n) => n.getAttribute('data-above-composer-conversation-id')).filter(Boolean);
  const unique = [...new Set(markers)];
  if (unique.length !== 1 || !uuid.test(unique[0])) return { threadId: null, turnIds: [], reason: 'no-unique-codex-thread' };
  const turnIds = [];
  for (const node of document.querySelectorAll('[data-local-conversation-final-assistant]')) {
    if (node.closest(hidden)) continue;
    const content = node.closest('[data-content-search-turn-key]')?.getAttribute('data-content-search-turn-key');
    const key = node.closest('[data-turn-key]')?.getAttribute('data-turn-key');
    const historical = key?.startsWith('history-content:turn:') ? key.slice('history-content:turn:'.length) : null;
    if (content && historical && content.toLowerCase() !== historical.toLowerCase()) continue;
    const turn = uuid.test(content ?? '') ? content : uuid.test(historical ?? '') ? historical : null;
    if (turn) turnIds.push(turn.toLowerCase());
  }
  return { threadId: unique[0].toLowerCase(), turnIds: [...new Set(turnIds)], reason: null };
}

export function installUsageView(readContext) {
  const key = '__codexTokenBar';
  if (window[key]) return { ok: true, existing: true };
  if (typeof ResizeObserver !== 'function' || typeof MutationObserver !== 'function'
    || typeof HTMLElement.prototype.showPopover !== 'function' || typeof HTMLElement.prototype.hidePopover !== 'function'
    || typeof HTMLElement.prototype.attachShadow !== 'function') {
    return { ok: false, reason: 'unsupported-browser-capabilities' };
  }
  const hidden = '[data-app-shell-active-page="false"], [aria-hidden="true"], [inert]';
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const mounts = new Map();
  const internalNodes = new WeakSet();
  let data = { threadId: null, rows: [] };
  let diagnostics = {};
  let timer, lease, observer, sizes, stopped = false;
  const removeHost = (host) => { internalNodes.add(host); host.remove(); };
  const clear = () => { for (const { host } of mounts.values()) removeHost(host); mounts.clear(); sizes?.disconnect(); };
  const stop = (disabled = true) => {
    if (stopped) return;
    stopped = true;
    observer.disconnect(); sizes.disconnect(); clearTimeout(timer); clearTimeout(lease);
    window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule);
    clear(); delete window[key];
    if (disabled) window.__codexTokenBarDisabled = true;
  };
  const valid = (u) => u && Number.isSafeInteger(u.total) && u.total >= 0
    && Number.isSafeInteger(u.input) && u.input >= 0 && Number.isSafeInteger(u.output) && u.output >= 0
    && Number.isSafeInteger(u.input + u.output) && u.total === u.input + u.output;
  const tokens = (u) => !valid(u) ? '--' : u.total > 0 && u.total < 10 ? '<0.01k'
    : (u.total / 1000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + 'k';
  const cache = (u) => valid(u) && u.input > 0 && Number.isSafeInteger(u.cached) && u.cached >= 0 && u.cached <= u.input
    ? (u.cached / u.input * 100).toFixed(2) + '%' : '--';
  const description = (u) => valid(u) ? `1k = 1,000 Token，显示四舍五入至两位小数；精确用量：输入 ${u.input.toLocaleString('en-US')} + 输出 ${u.output.toLocaleString('en-US')} = ${u.total.toLocaleString('en-US')} Token；缓存输入 ${u.cached == null ? '--' : u.cached.toLocaleString('en-US')}` : '没有可核对的官方数据';
  function positionPanel(host) {
    const panel = host.shadowRoot.querySelector('.panel');
    if (panel.hidden) return;
    const bar = host.shadowRoot.querySelector('.bar').getBoundingClientRect();
    panel.style.maxHeight = Math.max(0, bar.top - 16) + 'px';
    const bounds = panel.getBoundingClientRect();
    panel.style.left = Math.max(8, Math.min(bar.left, innerWidth - bounds.width - 8)) + 'px';
    panel.style.top = Math.max(8, bar.top - bounds.height - 8) + 'px';
  }
  function render(host, row) {
    const values = [tokens(row.turn), cache(row.turn), tokens(row.cumulative), cache(row.cumulative)];
    for (const [i, span] of [...host.shadowRoot.querySelectorAll('span')].entries()) {
      const value = span.querySelector('strong');
      if (value.textContent !== values[i]) value.textContent = values[i];
      span.title = description(i < 2 ? row.turn : row.cumulative);
    }
    const exact = (value) => Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('en-US') : '--';
    const details = {
      input: valid(row.turn) ? exact(row.turn.input) : '--',
      output: valid(row.turn) ? exact(row.turn.output) : '--',
      speed: Number.isFinite(row.speed) && row.speed >= 0 ? row.speed.toFixed(1) + ' tok/s' : '--',
      duration: Number.isSafeInteger(row.durationMs) && row.durationMs >= 0 ? (row.durationMs / 1000).toFixed(1) + ' s' : '--',
    };
    for (const [name, text] of Object.entries(details)) {
      const value = host.shadowRoot.querySelector(`[data-detail="${name}"]`);
      if (value.textContent !== text) value.textContent = text;
    }
    positionPanel(host);
  }
  function reconcileLayout() {
    if (stopped) return;
    diagnostics = { ambiguousAnchors: 0, unsupportedLayout: 0, invalidGeometry: 0 };
    const context = readContext();
    if (!context.threadId || context.threadId !== data.threadId) { clear(); return; }
    const rows = new Map(data.rows.map((r) => [r.turnId, r]));
    const candidates = new Map();
    for (const node of document.querySelectorAll('[data-local-conversation-final-assistant]')) {
      if (node.closest(hidden)) continue;
      const content = node.closest('[data-content-search-turn-key]')?.getAttribute('data-content-search-turn-key');
      const key = node.closest('[data-turn-key]')?.getAttribute('data-turn-key');
      const historical = key?.startsWith('history-content:turn:') ? key.slice('history-content:turn:'.length) : null;
      if (content && historical && content.toLowerCase() !== historical.toLowerCase()) continue;
      const id = uuid.test(content ?? '') ? content.toLowerCase() : uuid.test(historical ?? '') ? historical.toLowerCase() : null;
      if (!id || !rows.has(id)) continue;
      const list = candidates.get(id) ?? []; list.push(node); candidates.set(id, list);
    }
    for (const [id, entry] of mounts) {
      const list = candidates.get(id);
      const style = getComputedStyle(entry.anchor);
      const compatible = style.display === 'block' || (style.display === 'flex' && style.flexDirection === 'column');
      if (list?.length !== 1 || list[0] !== entry.anchor || entry.host.parentElement !== entry.anchor || entry.anchor.lastElementChild !== entry.host || !compatible) {
        sizes.unobserve(entry.anchor); removeHost(entry.host); mounts.delete(id);
      }
    }
    for (const [id, nodes] of candidates) {
      if (nodes.length !== 1) { diagnostics.ambiguousAnchors++; continue; }
      const anchor = nodes[0];
      if (mounts.has(id)) { render(mounts.get(id).host, rows.get(id)); continue; }
      const before = anchor.getBoundingClientRect();
      const style = getComputedStyle(anchor);
      if (!(style.display === 'block' || (style.display === 'flex' && style.flexDirection === 'column'))) { diagnostics.unsupportedLayout++; continue; }
      if (before.width <= 0 || before.height <= 0 || before.bottom < 0 || before.top >= innerHeight) continue;
      const host = document.createElement('div');
      host.dataset.tokenbarOwned = 'usage'; host.dataset.tokenbarTurn = id;
      host.style.cssText = 'display:block;position:static;flex:0 0 auto;min-width:0;width:100%;box-sizing:border-box';
      host.attachShadow({ mode: 'open' }).innerHTML = `<style>
        :host{color:var(--color-text-secondary,var(--text-secondary,inherit));font-family:"Segoe UI Variable Text","Segoe UI","Microsoft YaHei UI",sans-serif}
        .bar{display:flex;align-items:center;gap:8px;padding:7px 0 5px;box-sizing:border-box;min-height:32px;font-size:12px;line-height:20px;font-variant-numeric:lining-nums tabular-nums}
        span{display:inline-flex;align-items:baseline;gap:5px;white-space:nowrap}
        small{font:inherit;opacity:.78}
        strong{font:inherit;font-weight:600;letter-spacing:.01em}
        button{padding:0;min-height:22px;font:inherit;color:inherit;background:transparent;border:0;border-radius:5px;cursor:pointer}
        .toggle{display:flex;flex:1;flex-wrap:wrap;align-items:center;gap:4px 18px;text-align:left}
        button:hover{opacity:1;background:color-mix(in srgb,currentColor 8%,transparent)}
        button:focus-visible{outline:2px solid currentColor;outline-offset:1px}
        .panel{position:fixed;inset:auto;box-sizing:border-box;width:min(360px,calc(100vw - 16px));margin:0;padding:14px 16px;overflow:auto;border:1px solid color-mix(in srgb,currentColor 14%,transparent);border-radius:12px;background:var(--color-bg-primary,var(--color-background,Canvas));color:inherit;box-shadow:0 8px 28px #0002;font-size:13px;line-height:22px;font-variant-numeric:tabular-nums}
        [hidden]{display:none}
        .panel h4{margin:0 0 10px;font:inherit;font-weight:600}
        dl{display:grid;grid-template-columns:1fr auto;gap:6px 24px;margin:0}
        dt{opacity:.78}dd{margin:0;text-align:right;font-weight:600}
      </style><div class="bar" role="note" aria-label="Token 使用统计"><button class="toggle" type="button" aria-label="展开本轮用量详情" aria-expanded="false" aria-controls="usage-details"><span><small>本轮</small> <strong></strong></span><span><small>缓存</small> <strong></strong></span><span><small>本对话累计</small> <strong></strong></span><span><small>累计缓存</small> <strong></strong></span></button></div><section id="usage-details" class="panel" aria-label="本轮用量详情" hidden><h4>本轮用量</h4><dl><dt>输入 Token</dt><dd data-detail="input"></dd><dt>输出 Token</dt><dd data-detail="output"></dd><dt>平均速度</dt><dd data-detail="speed"></dd><dt>时长（扣除工具）</dt><dd data-detail="duration"></dd></dl></section>`;
      render(host, rows.get(id));
      const children = [...anchor.children];
      internalNodes.add(host); anchor.append(host);
      const h = host.getBoundingClientRect(), a = anchor.getBoundingClientRect();
      const bottom = Math.max(a.top, ...children.map((n) => n.getBoundingClientRect().bottom));
      if (h.height < 20 || h.width <= 0 || h.top < bottom - 1 || h.left < a.left - 1 || h.right > a.right + 1 || h.bottom > a.bottom + 1) { diagnostics.invalidGeometry++; removeHost(host); continue; }
      const toggle = host.shadowRoot.querySelector('.toggle');
      const panel = host.shadowRoot.querySelector('.panel');
      panel.setAttribute('popover', 'auto');
      toggle.addEventListener('click', () => {
        if (panel.hidden) {
          panel.hidden = false;
          panel.showPopover();
          positionPanel(host);
        } else {
          panel.hidePopover();
          panel.hidden = true;
        }
        toggle.setAttribute('aria-expanded', String(!panel.hidden));
        toggle.setAttribute('aria-label', panel.hidden ? '展开本轮用量详情' : '收起本轮用量详情');
      });
      panel.addEventListener('toggle', (event) => {
        panel.hidden = event.newState !== 'open';
        toggle.setAttribute('aria-expanded', String(!panel.hidden));
        toggle.setAttribute('aria-label', panel.hidden ? '展开本轮用量详情' : '收起本轮用量详情');
      });
      mounts.set(id, { anchor, host }); sizes.observe(anchor);
    }
  }
  function reconcile() {
    try { reconcileLayout(); }
    catch { clear(); diagnostics = { reason: 'layout-inspection-failed' }; }
  }
  function schedule() { if (!stopped) { clearTimeout(timer); timer = setTimeout(reconcile, 50); } }
  observer = new MutationObserver((records) => {
    const consumed = new Set();
    const meaningful = records.some((record) => {
      if (record.type === 'attributes') return true;
      return [...record.addedNodes, ...record.removedNodes].some((node) => {
        if (internalNodes.has(node)) { consumed.add(node); return false; }
        return true;
      });
    });
    // Visit all records so internally added+removed failed mounts cannot create
    // a MutationObserver retry loop. Externally removed nodes still trigger it.
    for (const record of records) for (const node of [...record.addedNodes, ...record.removedNodes]) if (internalNodes.has(node)) consumed.add(node);
    for (const node of consumed) internalNodes.delete(node);
    if (meaningful) schedule();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['data-app-shell-active-page', 'aria-hidden', 'inert', 'data-above-composer-conversation-id', 'data-content-search-turn-key', 'data-turn-key', 'class', 'style'] });
  sizes = new ResizeObserver(schedule);
  window.addEventListener('scroll', schedule, { capture: true, passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  const renew = () => { clearTimeout(lease); lease = setTimeout(() => stop(false), 15000); };
  window[key] = {
    context: readContext,
    stop: () => stop(true),
    update(next) {
      data = next && uuid.test(next.threadId ?? '') && Array.isArray(next.rows) ? next : { threadId: null, rows: [] };
      renew(); reconcile(); return { ok: true, mountedRows: mounts.size, diagnostics,
        reason: diagnostics.reason ?? (diagnostics.ambiguousAnchors ? 'ambiguous-reply-anchors'
          : diagnostics.unsupportedLayout ? 'unsupported-reply-layout' : diagnostics.invalidGeometry ? 'unsafe-mount-geometry' : null) };
    },
  };
  renew();
  return { ok: true, existing: false };
}
