import { verifyMediaSig } from "@/lib/crypto";
import { mimeFor, serveFile } from "@/lib/serve";
import { getVideo } from "@/lib/videos";

type Ctx = { params: Promise<{ id: string }> };

/** Public, but only with a valid time-limited signature (used by Instagram to download the video). */
async function handler(req: Request, { params }: Ctx) {
  const { id } = await params;
  const url = new URL(req.url);
  if (!verifyMediaSig(id, url.searchParams.get("exp") ?? "", url.searchParams.get("sig") ?? "")) return new Response("Forbidden", { status: 403 });
  const v = getVideo(id);
  if (!v || v.status !== "ready") return new Response("Not found", { status: 404 });
  return serveFile(v.stored_path, req, v.mime ?? mimeFor(v.stored_path));
}
export const GET = handler;
export const HEAD = handler;
