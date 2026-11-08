import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { connect } from '../src/cdp.mjs';
import { findRollout, RolloutReader } from '../src/rollout-reader.mjs';
import { pageContext, installUsageView } from '../src/usage-view.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const statusPath = path.join(root, 'work', 'tokenbar-state.json');
const stopPath = path.join(root, 'work', 'tokenbar.stop');
const port = Number(process.argv[2] ?? 9337);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid CDP port');
let session, reader, threadId, stopped = false, attached = false;
const status = async (phase, extra = {}) => fs.writeFile(statusPath, JSON.stringify({ phase, pid: process.pid, updatedAt: new Date().toISOString(), ...extra }, null, 2));
process.on('SIGINT', () => { stopped = true; }); process.on('SIGTERM', () => { stopped = true; });
try {
  await fs.mkdir(path.join(root, 'work'), { recursive: true });
  // During a cold launch the renderer endpoint can be replaced between the
  // readiness probe and this handshake. Retry only initial attachment.
  for (let attempt = 0; attempt < 3; attempt++) {
    try { session = await connect(port); break; }
    catch (error) {
      if (attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  await session.evaluate('window.__codexTokenBarDisabled = false; window.__codexTokenBar?.stop(); window.__codexTokenBarDisabled = false; true');
  await session.evaluate(`(${installUsageView})(${pageContext})`);
  attached = true;
  let missingRetryAt = 0;
  while (!stopped) {
    try { await fs.access(stopPath); break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const context = await session.evaluate('({disabled:window.__codexTokenBarDisabled===true,page:window.__codexTokenBar?.context()})');
    if (context.disabled) break;
    if (!context.page) { await session.evaluate(`(${installUsageView})(${pageContext})`); continue; }
    const page = context.page;
    if (page.threadId !== threadId) { reader = null; threadId = page.threadId; missingRetryAt = 0; }
    if (threadId && !reader && Date.now() >= missingRetryAt) {
      const file = await findRollout(path.join(os.homedir(), '.codex', 'sessions'), threadId);
      if (file) reader = new RolloutReader(file, threadId);
      else missingRetryAt = Date.now() + 10000;
    }
    let snapshot = { threadId, rows: [] };
    if (reader) {
      try { await reader.poll(); snapshot = reader.state.snapshot(page.turnIds); }
      catch { reader = null; missingRetryAt = Date.now() + 10000; }
    }
    const result = await session.evaluate(`window.__codexTokenBar.update(${JSON.stringify(snapshot)})`);
    const reason = !threadId ? page.reason : !reader ? 'session-data-unavailable'
      : !snapshot.rows.length ? 'no-completed-turn-data' : !result.mountedRows ? 'no-visible-compatible-anchor' : null;
    await status(!threadId ? 'waiting-codex-page' : result.mountedRows ? 'running' : 'waiting-statistics', { reason, mountedRows: result.mountedRows,
      completedRounds: reader ? [...reader.state.turns.values()].filter((t) => t.complete).length : 0,
      warnings: reader?.state.warningCounts ?? {} });
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await status('stopped');
} catch (error) {
  await status('disconnected-or-failed', { reason: error.message }).catch(() => {});
  process.exitCode = attached ? 2 : 1;
} finally {
  if (session) { await session.evaluate('window.__codexTokenBar?.stop()').catch(() => {}); session.close(); }
}
