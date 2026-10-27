import { z } from "zod";
import { handle, json } from "@/lib/api";
import { db } from "@/lib/db";
import { createPost, type PostRow } from "@/lib/posts";
import { postView } from "@/lib/views";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const rows = db().prepare("SELECT * FROM posts ORDER BY updated_at DESC LIMIT 300").all() as PostRow[];
  return json(rows.map(postView));
});

export const POST = handle(async (req: Request) => {
  const b = z.object({ videoId: z.string().uuid().nullable().optional(), title: z.string().max(200).optional() }).parse(await req.json());
  return json(postView(createPost(b.videoId ?? null, b.title ?? "")));
});
