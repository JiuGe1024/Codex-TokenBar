import { connect } from '../src/cdp.mjs';
import { inspectLayout, mountStaticBar } from '../src/static-bar.mjs';

const [mode, portArg, selector] = process.argv.slice(2);
const port = Number(portArg);
if (!['Inspect', 'Mount', 'Stop'].includes(mode) || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid probe arguments');
if (mode === 'Mount' && !selector) throw new Error('Mount requires a selector from an inspected live report');
const session = await connect(port);
let mounted = false;
try {
  if (mode === 'Inspect') console.log(JSON.stringify(await session.evaluate(`(${inspectLayout})()`), null, 2));
  if (mode === 'Stop') console.log(JSON.stringify(await session.evaluate('window.__codexTokenBarProbe?.stop() ?? {ok:true,removed:false}')));
  if (mode === 'Mount') {
    const result = await session.evaluate(`(${mountStaticBar})(${JSON.stringify(selector)})`);
    console.log(JSON.stringify(result));
    if (!result?.ok) process.exitCode = 2;
    else {
      mounted = true;
      // Keep the demo for at most 60 seconds, never leave an orphan injection.
      const end = Date.now() + 60000;
      while (Date.now() < end) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const state = await session.evaluate('window.__codexTokenBarProbe?.renew() ?? {ok:false}');
        if (!state?.ok) break;
      }
    }
  }
} finally {
  if (mounted) await session.evaluate('window.__codexTokenBarProbe?.stop()').catch(() => {});
  session.close();
}
