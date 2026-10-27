import { z } from "zod";
import { handle, json } from "@/lib/api";
import { db } from "@/lib/db";
import { publishPosts } from "@/lib/posts";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { error } from "@/lib/api";

/** «ОПУБЛИКОВАТЬ ВСЁ»: postIds given → those posts; all=true → every post that has draft targets. */
export const POST = handle(async (req: Request) => {
  if (!rateLimit(`publish:${clientIp(req.headers)}`, 30, 60_000)) return error("Слишком часто", 429);
  const b = z.object({ postIds: z.array(z.string().uuid()).max(500).optional(), all: z.boolean().optional() }).parse(await req.json());
  const ids = b.all
    ? (db().prepare("SELECT DISTINCT post_id FROM targets WHERE status = 'draft'").all() as { post_id: string }[]).map((r) => r.post_id)
    : b.postIds ?? [];
  return json(publishPosts(ids));
});
