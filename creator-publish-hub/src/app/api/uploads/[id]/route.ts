import { error, handle, json } from "@/lib/api";
import { appendChunk, getVideo, OffsetMismatch, receivedBytes } from "@/lib/videos";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const v = getVideo(id);
  if (!v) return error("Загрузка не найдена", 404);
  return json({ id, size: v.size, offset: receivedBytes(id), status: v.status });
});

/** Resumable chunk upload: header Upload-Offset must equal bytes already stored. */
export const PUT = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const offset = Number(req.headers.get("upload-offset"));
  if (!Number.isSafeInteger(offset) || offset < 0) return error("Нет заголовка Upload-Offset");
  if (!req.body) return error("Пустой фрагмент");
  try {
    const pos = await appendChunk(id, offset, req.body as any);
    return json({ offset: pos });
  } catch (e) {
    if (e instanceof OffsetMismatch) return json({ error: "offset_mismatch", offset: e.actual }, 409);
    throw e;
  }
});
