import fs from "node:fs";
import path from "node:path";
import { error, handle, json } from "@/lib/api";
import { db } from "@/lib/db";
import { EDITABLE, getTarget } from "@/lib/posts";
import { coversDir } from "@/lib/videos";

type Ctx = { params: Promise<{ id: string }> };

const TYPES: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png" };

/** Upload a custom cover image (JPEG/PNG, ≤ 2 MB per YouTube limits; Instagram requires JPEG). */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const t = getTarget(id);
  if (!t) return error("Задача не найдена", 404);
  if (!EDITABLE.includes(t.status)) return error("Обложку можно менять только до публикации");
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return error("Файл не передан");
  const ext = TYPES[file.type];
  if (!ext) return error("Обложка должна быть JPEG или PNG");
  if (file.size > 2 * 1024 * 1024) return error("Обложка больше 2 МБ");
  const buf = Buffer.from(await file.arrayBuffer());
  const magicOk = ext === ".jpg" ? buf[0] === 0xff && buf[1] === 0xd8 : buf.subarray(1, 4).toString() === "PNG";
  if (!magicOk) return error("Содержимое файла не соответствует изображению");
  const dest = path.join(coversDir(), `${id}${ext}`);
  fs.writeFileSync(dest, buf);
  const settings = JSON.parse(t.settings_json);
  const platform = (db().prepare("SELECT platform FROM accounts WHERE id = ?").get(t.account_id) as { platform: string }).platform;
  if (platform === "youtube") settings.coverVideoPath = dest; else settings.coverPath = dest;
  db().prepare("UPDATE targets SET settings_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(settings), Date.now(), id);
  return json({ ok: true });
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const t = getTarget(id);
  if (!t || !EDITABLE.includes(t.status)) return error("Нельзя изменить");
  const s = JSON.parse(t.settings_json);
  for (const k of ["coverPath", "coverVideoPath"]) if (s[k]) { fs.rmSync(s[k], { force: true }); delete s[k]; }
  db().prepare("UPDATE targets SET settings_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(s), Date.now(), id);
  return json({ ok: true });
});
