import { error, handle, json } from "@/lib/api";
import { db } from "@/lib/db";
import { mimeFor, serveFile } from "@/lib/serve";
import { deleteVideo, getVideo } from "@/lib/videos";

type Ctx = { params: Promise<{ id: string }> };

/** Authenticated preview stream. */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const v = getVideo(id);
  if (!v || v.status !== "ready") return new Response("Not found", { status: 404 });
  return serveFile(v.stored_path, req, v.mime ?? mimeFor(v.stored_path));
}

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const active = db().prepare(`SELECT COUNT(*) n FROM targets t JOIN posts p ON p.id = t.post_id
    WHERE p.video_id = ? AND t.status IN ('queued','uploading','processing','scheduled')`).get(id) as { n: number };
  if (active.n) return error("Видео используется в запланированных или активных задачах");
  deleteVideo(id);
  return json({ ok: true });
});
