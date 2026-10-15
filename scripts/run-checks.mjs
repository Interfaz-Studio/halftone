// Runs the /checks/ page in headless Chrome against a running dev server (npm run dev)
// and prints the results. Exit code 1 if any check fails.
//   node scripts/run-checks.mjs [url]
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://localhost:5173/checks/';
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9400 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), 'ht-checks-'));
const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

try {
  let targets;
  for (let i = 0; i < 50 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(200); } }
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); pending.delete(m.id); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.navigate', { url });
  let res;
  for (let i = 0; i < 120 && !res; i++) {
    await sleep(500);
    res = (await send('Runtime.evaluate', { expression: 'window.checks', returnByValue: true })).result.result?.value;
  }
  if (!res) throw new Error('Checks did not finish (is the dev server running?)');
  for (const r of res.results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  console.log(`\n${res.results.length - res.failed}/${res.results.length} passed`);
  ws.close();
  process.exitCode = res.failed ? 1 : 0;
} finally {
  // Wait for Chrome to exit before removing its profile, or it may still be writing to it
  const exited = new Promise(r => proc.once('exit', r));
  proc.kill();
  await Promise.race([exited, sleep(3000)]);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
