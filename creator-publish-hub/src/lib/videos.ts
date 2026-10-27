import fs from "node:fs";
import path from "node:path";
import { db } from "./db";
import { dataDir, maxUploadBytes } from "./config";
import { newId } from "./crypto";
import { ALLOWED_EXTENSIONS, probeVideo, type VideoMeta } from "./media";
import { checkVideo, PLATFORMS, type Issue, type Platform } from "./platforms/specs";

export type VideoRow = {
  id: string; filename: string; stored_path: string; size: number; mime: string | null; received: number;
  status: "uploading" | "ready" | "invalid"; meta_json: string | null; created_at: number;
};

export function videosDir() {
  const d = path.join(dataDir(), "videos");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function coversDir() {
  const d = path.join(dataDir(), "covers");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** Strips path parts and unsafe characters from a user-provided filename. */
export function safeFilename(name: string): string {
  const base = path.basename(name).replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 150);
  return base || "video";
}

export function createUpload(filename: string, size: number, mime: string | null): VideoRow {
  const name = safeFilename(filename);
  const ext = path.extname(name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) throw new UploadError(`Формат ${ext || "без расширения"} не поддерживается. Разрешено: ${ALLOWED_EXTENSIONS.join(", ")}`);
  if (!Number.isSafeInteger(size) || size <= 0) throw new UploadError("Неверный размер файла");
  if (size > maxUploadBytes()) throw new UploadError(`Файл больше лимита ${Math.round(maxUploadBytes() / 1024 ** 3)} ГБ`);
  const id = newId();
  const stored = path.join(videosDir(), `${id}${ext}`);
  fs.writeFileSync(stored, "");
  db().prepare("INSERT INTO videos(id, filename, stored_path, size, mime, received, status, created_at) VALUES(?, ?, ?, ?, ?, 0, 'uploading', ?)")
    .run(id, name, stored, size, mime && /^video\/[\w.+-]+$/.test(mime) ? mime : null, Date.now());
  return getVideo(id)!;
}

export class UploadError extends Error {}

export function getVideo(id: string): VideoRow | undefined {
  return db().prepare("SELECT * FROM videos WHERE id = ?").get(id) as VideoRow | undefined;
}

/** Appends a chunk at the given offset. Offset must equal bytes already received (resumable protocol). */
export async function appendChunk(id: string, offset: number, body: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>): Promise<number> {
  const v = getVideo(id);
  if (!v) throw new UploadError("Загрузка не найдена");
  if (v.status !== "uploading") throw new UploadError("Загрузка уже завершена");
  const actual = fs.statSync(v.stored_path).size;
  if (offset !== actual) throw new OffsetMismatch(actual);
  const fd = fs.openSync(v.stored_path, "r+");
  let pos = offset;
  try {
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      if (pos + chunk.length > v.size) throw new UploadError("Получено больше данных, чем заявлено");
      fs.writeSync(fd, chunk, 0, chunk.length, pos);
      pos += chunk.length;
    }
  } finally {
    fs.closeSync(fd);
    db().prepare("UPDATE videos SET received = ? WHERE id = ?").run(pos, id);
  }
  return pos;
}

export class OffsetMismatch extends Error {
  constructor(public actual: number) { super(`Ожидалось смещение ${actual}`); }
}

export function receivedBytes(id: string): number {
  const v = getVideo(id);
  if (!v) throw new UploadError("Загрузка не найдена");
  return fs.existsSync(v.stored_path) ? fs.statSync(v.stored_path).size : 0;
}

export async function finalizeUpload(id: string): Promise<VideoRow> {
  const v = getVideo(id);
  if (!v) throw new UploadError("Загрузка не найдена");
  if (v.status !== "uploading") return v;
  if (receivedBytes(id) !== v.size) throw new UploadError("Файл загружен не полностью");
  let meta: VideoMeta;
  try {
    meta = await probeVideo(v.stored_path);
  } catch (e: any) {
    db().prepare("UPDATE videos SET status = 'invalid', meta_json = ? WHERE id = ?").run(JSON.stringify({ error: String(e.message) }), id);
    throw new UploadError(`Файл не распознан как видео: ${e.message}`);
  }
  db().prepare("UPDATE videos SET status = 'ready', meta_json = ? WHERE id = ?").run(JSON.stringify(meta), id);
  return getVideo(id)!;
}

export function videoMeta(v: VideoRow): VideoMeta | null {
  if (!v.meta_json) return null;
  const m = JSON.parse(v.meta_json);
  return m.error ? null : m;
}

export function compatibility(v: VideoRow): Record<Platform, Issue[]> {
  const meta = videoMeta(v);
  const out = {} as Record<Platform, Issue[]>;
  for (const p of PLATFORMS) out[p] = meta ? checkVideo(p, meta, v.size) : [{ level: "error", message: "Видео ещё не проверено" }];
  return out;
}

export function deleteVideo(id: string) {
  const v = getVideo(id);
  if (!v) return;
  fs.rmSync(v.stored_path, { force: true });
  db().prepare("DELETE FROM videos WHERE id = ?").run(id);
}

/** Removes abandoned uploads older than 3 days. */
export function cleanupStaleUploads(maxAgeMs = 3 * 86400_000) {
  const rows = db().prepare("SELECT id FROM videos WHERE status = 'uploading' AND created_at < ?").all(Date.now() - maxAgeMs) as { id: string }[];
  for (const r of rows) deleteVideo(r.id);
  return rows.length;
}
