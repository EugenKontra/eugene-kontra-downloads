import { json } from "@/lib/api";
import { db, kvGet } from "@/lib/db";

export const dynamic = "force-dynamic";
export async function GET() {
  db().prepare("SELECT 1").get();
  const hb = Number(kvGet("worker_heartbeat") ?? 0);
  return json({ ok: true, workerAlive: Date.now() - hb < 60_000 });
}
