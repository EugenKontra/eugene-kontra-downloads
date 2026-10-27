import { error, handle, json } from "@/lib/api";
import { createPost } from "@/lib/posts";
import { finalizeUpload, getVideo } from "@/lib/videos";
import { postView } from "@/lib/views";
import { db } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!getVideo(id)) return error("Загрузка не найдена", 404);
  const v = await finalizeUpload(id);
  const existing = db().prepare("SELECT * FROM posts WHERE video_id = ? ORDER BY created_at LIMIT 1").get(id) as any;
  const post = existing ?? createPost(v.id, v.filename.replace(/\.[^.]+$/, ""));
  return json(postView(post));
});
