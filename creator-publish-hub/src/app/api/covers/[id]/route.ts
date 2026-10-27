import { hmac, safeEqual } from "@/lib/crypto";
import { getTarget } from "@/lib/posts";
import { mimeFor, serveFile } from "@/lib/serve";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const url = new URL(req.url);
  const exp = url.searchParams.get("exp") ?? "";
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now() / 1000 || !safeEqual(hmac(`cover.${id}.${exp}`), url.searchParams.get("sig") ?? "")) {
    return new Response("Forbidden", { status: 403 });
  }
  const t = getTarget(id);
  const path = t ? JSON.parse(t.settings_json).coverPath ?? JSON.parse(t.settings_json).coverVideoPath : null;
  if (!path) return new Response("Not found", { status: 404 });
  return serveFile(path, req, mimeFor(path));
}
