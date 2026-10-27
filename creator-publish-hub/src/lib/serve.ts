import fs from "node:fs";
import { Readable } from "node:stream";

/** Streams a file with HTTP Range support (needed by video players and by Instagram fetchers). */
export function serveFile(path: string, req: Request, mime: string): Response {
  if (!fs.existsSync(path)) return new Response("Not found", { status: 404 });
  const size = fs.statSync(path).size;
  const range = req.headers.get("range");
  const base = { "Content-Type": mime, "Accept-Ranges": "bytes", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    start = Math.max(0, start); end = Math.min(size - 1, end);
    if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const stream = Readable.toWeb(fs.createReadStream(path, { start, end })) as ReadableStream;
    return new Response(stream, { status: 206, headers: { ...base, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}` } });
  }
  if (req.method === "HEAD") return new Response(null, { headers: { ...base, "Content-Length": String(size) } });
  const stream = Readable.toWeb(fs.createReadStream(path)) as ReadableStream;
  return new Response(stream, { headers: { ...base, "Content-Length": String(size) } });
}

export function mimeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  return ({ mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" } as Record<string, string>)[ext ?? ""] ?? "application/octet-stream";
}
