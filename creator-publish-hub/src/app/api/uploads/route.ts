import { z } from "zod";
import { handle, json } from "@/lib/api";
import { createUpload } from "@/lib/videos";

export const POST = handle(async (req: Request) => {
  const b = z.object({ filename: z.string().min(1).max(300), size: z.number().int().positive(), type: z.string().max(100).optional() }).parse(await req.json());
  const v = createUpload(b.filename, b.size, b.type ?? null);
  return json({ id: v.id, offset: 0, size: v.size });
});
