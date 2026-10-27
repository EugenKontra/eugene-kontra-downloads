import { beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { freshEnv, fakeVideo, mockFetch, jsonRes } from "./setup";
import { saveConnectedAccount } from "../src/lib/accounts";
import { createPost, getTarget, getTargets, publishPosts, saveDraft } from "../src/lib/posts";
import { claimNext, releaseAllLeases, runTarget } from "../src/lib/queue";
import { chunkPlan } from "../src/lib/platforms/tiktok";
import { appendChunk, createUpload, finalizeUpload, OffsetMismatch, receivedBytes, UploadError } from "../src/lib/videos";
import { sanitize } from "../src/lib/platforms/http";
import { YT_CHUNK } from "../src/lib/platforms/youtube";

function prepare(platform: "youtube" | "instagram" | "tiktok", settings: Record<string, unknown>, size = 1024 * 1024) {
  const acc = saveConnectedAccount(platform, `${platform} RU`, { accessToken: "AT", refreshToken: "RT", expiresAt: Date.now() + 30 * 86400_000 }, { externalId: "IGUSER", displayName: "me" });
  const v = fakeVideo(size);
  const post = createPost(v.id, "t");
  saveDraft(post.id, "t", [{ accountId: acc, settings, scheduledAt: null }]);
  const r = publishPosts([post.id]);
  expect(r.problems).toEqual([]);
  return { target: getTargets(post.id)[0], v };
}

async function step(id: string, fetchFn: typeof fetch) {
  return runTarget(getTarget(id)!, fetchFn);
}

describe("YouTube adapter", () => {
  beforeEach(() => freshEnv());

  it("uploads with resumable chunks and publishes only after processing", async () => {
    const size = YT_CHUNK + 1000;
    const { target } = prepare("youtube", { title: "Мой Shorts", description: "d", tags: ["a"], privacy: "public" }, size);
    const m = mockFetch([
      (url, init) => { expect(url).toContain("uploadType=resumable"); expect(JSON.parse(String(init.body)).status.privacyStatus).toBe("public"); return new Response(null, { status: 200, headers: { location: "https://upload.test/session1" } }); },
      (url, init) => { expect((init.headers as any)["Content-Range"]).toBe(`bytes 0-${YT_CHUNK - 1}/${size}`); return new Response(null, { status: 308, headers: { range: `bytes=0-${YT_CHUNK - 1}` } }); },
      (_url, init) => { expect((init.headers as any)["Content-Range"]).toBe(`bytes ${YT_CHUNK}-${size - 1}/${size}`); return jsonRes({ id: "VID123" }, 201); },
      () => jsonRes({ items: [{ status: { uploadStatus: "uploaded", privacyStatus: "public" } }] }),
    ]);
    expect(await step(target.id, m.fn)).toBe("processing");
    expect(getTarget(target.id)!.url).toBeNull();
    const m2 = mockFetch([() => jsonRes({ items: [{ status: { uploadStatus: "processed", privacyStatus: "public" } }] })]);
    expect(await step(target.id, m2.fn)).toBe("published");
    const t = getTarget(target.id)!;
    expect(t.url).toBe("https://www.youtube.com/watch?v=VID123");
    expect(t.external_id).toBe("VID123");
  });

  it("resumes an interrupted upload from the offset YouTube reports (no duplicate video)", async () => {
    const size = YT_CHUNK * 2;
    const { target } = prepare("youtube", { title: "x", privacy: "private" }, size);
    const m = mockFetch([
      () => new Response(null, { status: 200, headers: { location: "https://upload.test/s" } }),
      () => new Response(null, { status: 308, headers: { range: `bytes=0-${YT_CHUNK - 1}` } }),
      () => { throw new TypeError("socket hang up"); },
    ]);
    await step(target.id, m.fn);
    expect(getTarget(target.id)!.error_code).toBe("network");
    // Worker restart
    releaseAllLeases();
    const m2 = mockFetch([
      (_u, init) => { expect((init.headers as any)["Content-Range"]).toBe(`bytes */${size}`); return new Response(null, { status: 308, headers: { range: `bytes=0-${YT_CHUNK - 1}` } }); },
      (_u, init) => { expect((init.headers as any)["Content-Range"]).toBe(`bytes ${YT_CHUNK}-${size - 1}/${size}`); return jsonRes({ id: "V2" }, 200); },
      () => jsonRes({ items: [{ status: { uploadStatus: "processed", privacyStatus: "private" } }] }),
    ]);
    expect(await step(target.id, m2.fn)).toBe("published");
    expect(m2.calls.some((c) => c.url.includes("uploadType=resumable"))).toBe(false);
  });

  it("reports rejection as failure", async () => {
    const { target } = prepare("youtube", { title: "x", privacy: "private" });
    const m = mockFetch([
      () => new Response(null, { status: 200, headers: { location: "https://upload.test/s" } }),
      () => jsonRes({ id: "V3" }, 201),
      () => jsonRes({ items: [{ status: { uploadStatus: "rejected", rejectionReason: "duplicate" } }] }),
    ]);
    expect(await step(target.id, m.fn)).toBe("failed");
    expect(getTarget(target.id)!.error_message).toContain("duplicate");
  });
});

describe("Instagram adapter", () => {
  beforeEach(() => freshEnv());

  it("creates container with signed video URL, waits, publishes, returns permalink", async () => {
    const { target, v } = prepare("instagram", { caption: "Привет", hashtags: ["reels", "#юмор"] });
    const m = mockFetch([
      (url, init) => {
        expect(url).toContain("/IGUSER/media");
        const p = new URLSearchParams(String(init.body));
        expect(p.get("media_type")).toBe("REELS");
        expect(p.get("video_url")).toMatch(new RegExp(`^https://hub.test/api/media/${v.id}\\?exp=\\d+&sig=`));
        expect(p.get("caption")).toBe("Привет\n\n#reels #юмор");
        return jsonRes({ id: "C1" });
      },
    ]);
    expect(await step(target.id, m.fn)).toBe("processing");
    const m2 = mockFetch([() => jsonRes({ status_code: "IN_PROGRESS" })]);
    expect(await step(target.id, m2.fn)).toBe("processing");
    const m3 = mockFetch([
      () => jsonRes({ status_code: "FINISHED" }),
      (url, init) => { expect(url).toContain("media_publish"); expect(String(init.body)).toContain("creation_id=C1"); return jsonRes({ id: "M1" }); },
      () => jsonRes({ permalink: "https://www.instagram.com/reel/abc/" }),
    ]);
    expect(await step(target.id, m3.fn)).toBe("published");
    expect(getTarget(target.id)!.url).toBe("https://www.instagram.com/reel/abc/");
  });

  it("fails clearly when Instagram cannot process the video", async () => {
    const { target } = prepare("instagram", { caption: "" });
    await step(target.id, mockFetch([() => jsonRes({ id: "C2" })]).fn);
    expect(await step(target.id, mockFetch([() => jsonRes({ status_code: "ERROR", status: "Error: unsupported format" })]).fn)).toBe("failed");
    expect(getTarget(target.id)!.error_message).toContain("unsupported format");
  });
});

describe("TikTok adapter", () => {
  beforeEach(() => freshEnv());
  const direct = { caption: "Тест", hashtags: ["fyp"], privacy: "SELF_ONLY", musicConsent: true, mode: "direct" };

  it("chunk plan follows media transfer rules", () => {
    expect(chunkPlan(3e6)).toEqual({ chunkSize: 3e6, count: 1 });
    const p = chunkPlan(4 * 1024 ** 3);
    expect(p.count).toBeLessThanOrEqual(1000);
    const last = 4 * 1024 ** 3 - p.chunkSize * (p.count - 1);
    expect(last).toBeLessThanOrEqual(128 * 1024 * 1024);
  });

  it("direct post: creator info → init → chunk upload → PUBLISH_COMPLETE", async () => {
    const size = 25 * 1024 * 1024;
    const { target } = prepare("tiktok", direct, size);
    const m = mockFetch([
      () => jsonRes({ data: { privacy_level_options: ["SELF_ONLY"], creator_username: "me", max_video_post_duration_sec: 600 }, error: { code: "ok" } }),
      (url, init) => { expect(url).toContain("/post/publish/video/init/"); const b = JSON.parse(String(init.body)); expect(b.post_info.privacy_level).toBe("SELF_ONLY"); expect(b.source_info.total_chunk_count).toBe(2); return jsonRes({ data: { publish_id: "P1", upload_url: "https://up.tiktok/1" }, error: { code: "ok" } }); },
      (_u, init) => { expect((init.headers as any)["Content-Range"]).toBe(`bytes 0-${10 * 1024 * 1024 - 1}/${size}`); return new Response(null, { status: 206 }); },
      (_u, init) => { expect((init.headers as any)["Content-Range"]).toBe(`bytes ${10 * 1024 * 1024}-${size - 1}/${size}`); return new Response(null, { status: 201 }); },
    ]);
    expect(await step(target.id, m.fn)).toBe("processing");
    expect(await step(target.id, mockFetch([() => jsonRes({ data: { status: "PROCESSING_UPLOAD" }, error: { code: "ok" } })]).fn)).toBe("processing");
    expect(await step(target.id, mockFetch([() => jsonRes({ data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: [] }, error: { code: "ok" } })]).fn)).toBe("published");
  });

  it("inbox mode ends with «action required», never as published", async () => {
    const { target } = prepare("tiktok", { caption: "x", mode: "inbox" });
    const m = mockFetch([
      (url) => { expect(url).toContain("/inbox/video/init/"); return jsonRes({ data: { publish_id: "P2", upload_url: "https://up.tiktok/2" }, error: { code: "ok" } }); },
      () => new Response(null, { status: 201 }),
      () => jsonRes({ data: { status: "SEND_TO_USER_INBOX" }, error: { code: "ok" } }),
    ]);
    await step(target.id, m.fn);
    expect(await step(target.id, m.fn)).toBe("action_required");
    expect(getTarget(target.id)!.error_message).toContain("TikTok");
  });

  it("explains unaudited-app restriction", async () => {
    const { target } = prepare("tiktok", { ...direct, privacy: "PUBLIC_TO_EVERYONE" });
    const m = mockFetch([
      () => jsonRes({ data: { privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"] }, error: { code: "ok" } }),
      () => jsonRes({ error: { code: "unaudited_client_can_only_post_to_private_accounts", message: "" } }, 403),
    ]);
    expect(await step(target.id, m.fn)).toBe("failed");
    expect(getTarget(target.id)!.error_message).toContain("аудит");
  });

  it("requires privacy choice and music consent for direct post", () => {
    const acc = saveConnectedAccount("tiktok", "TikTok RU", { accessToken: "AT" }, { externalId: "x", displayName: "x" });
    const v = fakeVideo(1024 * 1024);
    const post = createPost(v.id);
    saveDraft(post.id, "", [{ accountId: acc, settings: { mode: "direct" }, scheduledAt: null }]);
    const r = publishPosts([post.id]);
    expect(r.problems[0].messages.join(" ")).toMatch(/видимость|смотреть/);
    expect(r.problems[0].messages.join(" ")).toContain("Music");
  });
});

describe("uploads", () => {
  beforeEach(() => freshEnv());

  it("rejects disallowed extensions and path traversal names", () => {
    expect(() => createUpload("evil.exe", 10, null)).toThrow(UploadError);
    const v = createUpload("../../etc/passwd.mp4", 10, "video/mp4");
    expect(path.dirname(v.stored_path)).toBe(path.join(process.env.DATA_DIR!, "videos"));
    expect(v.filename).toBe("passwd.mp4");
  });

  it("resumable chunked upload with offset checks + ffprobe validation", async () => {
    const src = path.join(process.env.DATA_DIR!, "src.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=360x640:rate=30", "-f", "lavfi", "-i", "sine", "-t", "4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", src]);
    const data = fs.readFileSync(src);
    const v = createUpload("clip.mp4", data.length, "video/mp4");
    const half = Math.floor(data.length / 2);
    await appendChunk(v.id, 0, [data.subarray(0, half)] as any);
    await expect(appendChunk(v.id, 0, [data.subarray(0, 10)] as any)).rejects.toBeInstanceOf(OffsetMismatch);
    expect(receivedBytes(v.id)).toBe(half);
    await expect(finalizeUpload(v.id)).rejects.toThrow("не полностью");
    await appendChunk(v.id, half, [data.subarray(half)] as any);
    const ready = await finalizeUpload(v.id);
    expect(ready.status).toBe("ready");
    const meta = JSON.parse(ready.meta_json!);
    expect(meta.width).toBe(360);
    expect(meta.height).toBe(640);
    expect(meta.durationSec).toBeGreaterThan(3.5);
  });

  it("rejects non-video content", async () => {
    const v = createUpload("fake.mp4", 5, null);
    await appendChunk(v.id, 0, [Buffer.from("hello")] as any);
    await expect(finalizeUpload(v.id)).rejects.toThrow("не распознан");
  });
});

describe("secrets", () => {
  it("never stores tokens in logs", () => {
    const s = JSON.stringify(sanitize({ access_token: "abc", nested: { refresh_token: "x", url: "https://a?access_token=SECRET&b=1" } }));
    expect(s).not.toContain("abc");
    expect(s).not.toContain("SECRET");
  });
});
