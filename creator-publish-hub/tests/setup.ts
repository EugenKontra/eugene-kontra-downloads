import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDb, db } from "../src/lib/db";

export function freshEnv() {
  closeDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-test-"));
  process.env.DATA_DIR = dir;
  process.env.ENCRYPTION_KEY = "a".repeat(64);
  process.env.SESSION_SECRET = "b".repeat(64);
  process.env.PUBLIC_BASE_URL = "https://hub.test";
  process.env.GOOGLE_CLIENT_ID = "gid"; process.env.GOOGLE_CLIENT_SECRET = "gsecret";
  process.env.INSTAGRAM_APP_ID = "iid"; process.env.INSTAGRAM_APP_SECRET = "isecret";
  process.env.TIKTOK_CLIENT_KEY = "tkey"; process.env.TIKTOK_CLIENT_SECRET = "tsecret";
  db();
  return dir;
}

/** Inserts a ready video with given metadata (file content is fake bytes). */
export function fakeVideo(size = 25 * 1024 * 1024, meta: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  const file = path.join(process.env.DATA_DIR!, `${id}.mp4`);
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i += 4096) buf[i] = i % 251;
  fs.writeFileSync(file, buf);
  const m = { container: "mov,mp4,m4a,3gp,3g2,mj2", durationSec: 30, width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac", fps: 30, bitrate: 1, rotation: 0, ...meta };
  db().prepare("INSERT INTO videos(id, filename, stored_path, size, mime, received, status, meta_json, created_at) VALUES(?, 'clip.mp4', ?, ?, 'video/mp4', ?, 'ready', ?, ?)")
    .run(id, file, size, size, JSON.stringify(m), Date.now());
  return { id, file };
}

/** Sequential fetch mock: each handler checks the request and returns a Response. */
export function mockFetch(handlers: ((url: string, init: RequestInit) => Response | Promise<Response>)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: any, init: any = {}) => {
    calls.push({ url: String(url), init });
    const h = handlers.shift();
    if (!h) throw new Error(`Unexpected request ${init.method ?? "GET"} ${url}`);
    return h(String(url), init);
  }) as typeof fetch;
  return { fn, calls, remaining: () => handlers.length };
}

export const jsonRes = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
