// Local runs: load .env files (in Docker variables come from the environment).
for (const f of [".env.local", ".env"]) { try { process.loadEnvFile(f); } catch { /* not present */ } }

import { claimNext, heartbeat, promoteDue, releaseAllLeases, runTarget } from "../lib/queue";
import { cleanupStaleUploads } from "../lib/videos";
import { logEvent } from "../lib/events";

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 2);
const TICK_MS = 5_000;
let running = 0;
let stopping = false;

async function tick() {
  heartbeat();
  const promoted = promoteDue();
  if (promoted) console.log(`[worker] запланированных задач к запуску: ${promoted}`);
  while (!stopping && running < CONCURRENCY) {
    const t = claimNext();
    if (!t) break;
    running++;
    runTarget(t)
      .then((s) => console.log(`[worker] ${t.id} → ${s}`))
      .finally(() => { running--; });
  }
}

async function main() {
  const released = releaseAllLeases();
  logEvent(null, "info", `Воркер запущен${released ? `, восстановлено задач после перезапуска: ${released}` : ""}`);
  console.log(`[worker] старт, параллельность ${CONCURRENCY}`);
  setInterval(() => { try { cleanupStaleUploads(); } catch (e) { console.error(e); } }, 6 * 3600_000);
  while (!stopping) {
    try { await tick(); } catch (e) { console.error("[worker] tick error", e); }
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stopping = true;
    console.log(`[worker] остановка (${sig}), активных задач: ${running}`);
    const wait = setInterval(() => { if (running === 0) process.exit(0); }, 500);
    setTimeout(() => { clearInterval(wait); process.exit(0); }, 30_000);
  });
}

main();
