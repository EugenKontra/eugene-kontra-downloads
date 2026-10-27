import { z } from "zod";
import { error, handle, json } from "@/lib/api";
import { db } from "@/lib/db";
import { cancelTarget, rescheduleTarget, retryTarget, unscheduleTarget } from "@/lib/posts";
import { berlinLocalToUtc } from "@/lib/time";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const b = z.object({
    action: z.enum(["cancel", "retry", "reschedule", "unschedule"]),
    scheduledLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/).or(z.literal("")).optional(),
  }).parse(await req.json());
  const r = b.action === "cancel" ? cancelTarget(id)
    : b.action === "retry" ? retryTarget(id)
    : b.action === "unschedule" ? unscheduleTarget(id)
    : rescheduleTarget(id, b.scheduledLocal ? berlinLocalToUtc(b.scheduledLocal) : null);
  return r.ok ? json({ ok: true }) : error(r.reason!);
});

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const events = db().prepare("SELECT id, ts, level, message, data_json FROM events WHERE target_id = ? ORDER BY ts DESC LIMIT 200").all(id);
  return json({ events });
});
