import { z } from "zod";
import { error, handle, json } from "@/lib/api";
import { deletePost, getPost, saveDraft } from "@/lib/posts";
import { berlinLocalToUtc } from "@/lib/time";
import { postView } from "@/lib/views";

type Ctx = { params: Promise<{ id: string }> };

const TargetSchema = z.object({
  accountId: z.string().uuid(),
  scheduledLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/).or(z.literal("")).nullable().optional(),
  settings: z.record(z.unknown()),
});

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const p = getPost((await params).id);
  return p ? json(postView(p)) : error("Публикация не найдена", 404);
});

export const PUT = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!getPost(id)) return error("Публикация не найдена", 404);
  const b = z.object({ title: z.string().max(200), targets: z.array(TargetSchema).max(50) }).parse(await req.json());
  saveDraft(id, b.title, b.targets.map((t) => {
    // Server-managed fields are never taken from the client.
    const { coverPath, coverVideoPath, ...settings } = t.settings as any;
    return { accountId: t.accountId, settings, scheduledAt: t.scheduledLocal ? berlinLocalToUtc(t.scheduledLocal) : null };
  }));
  return json(postView(getPost(id)!));
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const r = deletePost((await params).id);
  return r.ok ? json({ ok: true }) : error(r.reason!);
});
