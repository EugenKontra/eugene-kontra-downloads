import { z } from "zod";
import { error, handle, json } from "@/lib/api";
import { deleteAccount, getAccount, setAccountStatus, toPublic, updateAccount } from "@/lib/accounts";
import { db } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const a = getAccount(id);
  if (!a) return error("Аккаунт не найден", 404);
  const body = z.object({ label: z.string().trim().min(1).max(60).optional(), enabled: z.boolean().optional() }).parse(await req.json());
  if (body.label) updateAccount(id, { label: body.label });
  if (body.enabled === false) setAccountStatus(id, "disabled", "Отключён пользователем");
  if (body.enabled === true && a.status === "disabled") setAccountStatus(id, "connected");
  return json(toPublic(getAccount(id)!));
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const active = db().prepare("SELECT COUNT(*) n FROM targets WHERE account_id = ? AND status IN ('queued','uploading','processing')").get(id) as { n: number };
  if (active.n) return error("У аккаунта есть задачи в процессе публикации");
  deleteAccount(id);
  return json({ ok: true });
});
