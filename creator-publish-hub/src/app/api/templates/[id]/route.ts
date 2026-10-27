import { handle, json } from "@/lib/api";
import { db } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };
export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  db().prepare("DELETE FROM templates WHERE id = ?").run((await params).id);
  return json({ ok: true });
});
