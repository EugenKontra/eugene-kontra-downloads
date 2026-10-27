import { z } from "zod";
import { handle, json } from "@/lib/api";
import { newId } from "@/lib/crypto";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const GET = handle(async () => json(db().prepare("SELECT * FROM templates ORDER BY name").all()));
export const POST = handle(async (req: Request) => {
  const b = z.object({ name: z.string().trim().min(1).max(80), platform: z.enum(["any", "youtube", "instagram", "tiktok"]), body: z.string().max(5000) }).parse(await req.json());
  const id = newId();
  db().prepare("INSERT INTO templates(id, name, platform, body, created_at) VALUES(?, ?, ?, ?, ?)").run(id, b.name, b.platform, b.body, Date.now());
  return json({ id });
});
