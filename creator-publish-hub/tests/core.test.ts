import { beforeEach, describe, expect, it } from "vitest";
import { freshEnv, fakeVideo, mockFetch, jsonRes } from "./setup";
import { berlinLocalToUtc, utcToBerlinLocal } from "../src/lib/time";
import { decrypt, encrypt, hashPassword, signMediaPath, verifyMediaSig, verifyPassword } from "../src/lib/crypto";
import { checkVideo } from "../src/lib/platforms/specs";
import { saveConnectedAccount, getAccount } from "../src/lib/accounts";
import { cancelTarget, createPost, getTarget, getTargets, publishPosts, retryTarget, saveDraft } from "../src/lib/posts";
import { claimNext, promoteDue, releaseAllLeases, runTarget, LEASE_MS } from "../src/lib/queue";
import { db } from "../src/lib/db";

const YT = { title: "Тест", description: "", tags: [], privacy: "private" };

function account(platform: "youtube" | "instagram" | "tiktok", label = `${platform} RU`) {
  return saveConnectedAccount(platform, label, { accessToken: `tok-${platform}`, refreshToken: "ref", expiresAt: Date.now() + 30 * 86400_000 }, { externalId: `ext-${platform}-${label}`, displayName: label });
}

describe("time (Europe/Berlin, DST)", () => {
  it("converts winter and summer time", () => {
    expect(new Date(berlinLocalToUtc("2026-01-10T12:00")).toISOString()).toBe("2026-01-10T11:00:00.000Z");
    expect(new Date(berlinLocalToUtc("2026-07-01T12:00")).toISOString()).toBe("2026-07-01T10:00:00.000Z");
  });
  it("shifts non-existent spring-forward time forward", () => {
    expect(new Date(berlinLocalToUtc("2026-03-29T02:30")).toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });
  it("resolves ambiguous fall-back time to first occurrence", () => {
    expect(new Date(berlinLocalToUtc("2026-10-25T02:30")).toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });
  it("round-trips", () => {
    for (const s of ["2026-03-28T23:59", "2026-10-26T08:15", "2027-12-31T00:00"]) expect(utcToBerlinLocal(berlinLocalToUtc(s))).toBe(s);
  });
});

describe("crypto", () => {
  beforeEach(() => freshEnv());
  it("encrypts tokens with AES-GCM and detects tampering", () => {
    const c = encrypt("secret-token");
    expect(c).not.toContain("secret-token");
    expect(decrypt(c)).toBe("secret-token");
    const parts = c.split("."); parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("A") ? "BB" : "AA");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
  it("hashes passwords", () => {
    const h = hashPassword("correct horse battery");
    expect(verifyPassword("correct horse battery", h)).toBe(true);
    expect(verifyPassword("wrong", h)).toBe(false);
  });
  it("signs media URLs with expiry", () => {
    const u = new URL("https://x" + signMediaPath("vid1"));
    expect(verifyMediaSig("vid1", u.searchParams.get("exp")!, u.searchParams.get("sig")!)).toBe(true);
    expect(verifyMediaSig("vid2", u.searchParams.get("exp")!, u.searchParams.get("sig")!)).toBe(false);
    expect(verifyMediaSig("vid1", "1000", u.searchParams.get("sig")!)).toBe(false);
  });
});

describe("video compatibility", () => {
  const meta = { container: "mov,mp4,m4a,3gp,3g2,mj2", durationSec: 30, width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac", fps: 30, bitrate: 1, rotation: 0 };
  it("accepts a normal vertical short everywhere", () => {
    for (const p of ["youtube", "instagram", "tiktok"] as const) expect(checkVideo(p, meta, 50e6).filter((i) => i.level === "error")).toEqual([]);
  });
  it("rejects too large file for Instagram but not YouTube", () => {
    expect(checkVideo("instagram", meta, 2 * 1024 ** 3).some((i) => i.level === "error")).toBe(true);
    expect(checkVideo("youtube", meta, 2 * 1024 ** 3).some((i) => i.level === "error")).toBe(false);
  });
  it("rejects wrong codecs and short duration", () => {
    expect(checkVideo("instagram", { ...meta, audioCodec: "opus" }, 1e6).some((i) => i.message.includes("AAC"))).toBe(true);
    expect(checkVideo("tiktok", { ...meta, durationSec: 1 }, 1e6).some((i) => i.level === "error")).toBe(true);
  });
});

describe("publishing flow and queue", () => {
  beforeEach(() => freshEnv());

  function setup() {
    const yt = account("youtube");
    const ig = account("instagram");
    const v = fakeVideo(1024 * 1024);
    const post = createPost(v.id, "Ролик");
    saveDraft(post.id, "Ролик", [
      { accountId: yt, settings: YT, scheduledAt: null },
      { accountId: ig, settings: { caption: "Привет" }, scheduledAt: null },
    ]);
    return { yt, ig, post, v };
  }

  it("stores tokens encrypted", () => {
    const id = account("youtube");
    const row = getAccount(id)!;
    expect(row.access_token_enc).not.toContain("tok-youtube");
    expect(decrypt(row.access_token_enc!)).toBe("tok-youtube");
  });

  it("blocks publishing when required fields are missing", () => {
    const { post, yt } = setup();
    saveDraft(post.id, "x", [{ accountId: yt, settings: { ...YT, title: "" }, scheduledAt: null }]);
    const r = publishPosts([post.id]);
    expect(r.queued).toBe(0);
    expect(r.problems[0].messages.join()).toContain("название");
  });

  it("is idempotent: repeated «publish all» never enqueues twice", () => {
    const { post } = setup();
    const first = publishPosts([post.id]);
    const second = publishPosts([post.id]);
    expect(first.queued).toBe(2);
    expect(second.queued).toBe(0);
    expect(second.skipped).toBe(2);
    expect(getTargets(post.id).every((t) => t.status === "queued")).toBe(true);
  });

  it("schedules future tasks and promotes them when due", () => {
    const { post, yt } = setup();
    const at = Date.now() + 3600_000;
    saveDraft(post.id, "Ролик", [{ accountId: yt, settings: YT, scheduledAt: at }]);
    expect(publishPosts([post.id]).scheduled).toBe(1);
    expect(promoteDue(Date.now())).toBe(0);
    expect(claimNext()).toBeNull();
    expect(promoteDue(at + 1)).toBe(1);
    expect(claimNext(at + 1)?.account_id).toBe(yt);
  });

  it("leases prevent double processing and are recovered after restart", () => {
    const { post } = setup();
    publishPosts([post.id]);
    const a = claimNext()!;
    const b = claimNext()!;
    expect(a.id).not.toBe(b.id);
    expect(claimNext()).toBeNull();
    // Crash: leases are released on worker start
    expect(releaseAllLeases()).toBe(2);
    expect(claimNext()).not.toBeNull();
    // Expired lease is also reclaimable
    db().prepare("UPDATE targets SET lease_until = ?").run(Date.now() - 1);
    expect(claimNext(Date.now() + LEASE_MS)).not.toBeNull();
  });

  it("retries transient errors with backoff, fails permanently on others; platforms are isolated", async () => {
    const { post, yt, ig } = setup();
    publishPosts([post.id]);
    const ytT = getTargets(post.id).find((t) => t.account_id === yt)!;
    const igT = getTargets(post.id).find((t) => t.account_id === ig)!;

    const m500 = mockFetch([() => jsonRes({ error: { code: 500, message: "Backend Error", errors: [{ reason: "backendError" }] } }, 500)]);
    expect(await runTarget(ytT, m500.fn)).toBe("uploading");
    const afterRetry = getTarget(ytT.id)!;
    expect(afterRetry.error_code).toBe("backendError");
    expect(afterRetry.next_attempt_at! - Date.now()).toBeGreaterThan(30_000);

    const m400 = mockFetch([() => jsonRes({ error: { message: "Invalid parameter", code: 100 } }, 400)]);
    expect(await runTarget(igT, m400.fn)).toBe("failed");
    expect(getTarget(igT.id)!.error_message).toContain("Invalid parameter");
    // YouTube task is still alive
    expect(getTarget(ytT.id)!.status).toBe("uploading");
    const events = db().prepare("SELECT * FROM events WHERE target_id = ?").all(igT.id);
    expect(events.length).toBeGreaterThan(0);
  });

  it("auth errors mark account for reconnect and task as action required", async () => {
    const { post, yt } = setup();
    publishPosts([post.id]);
    const t = getTargets(post.id).find((x) => x.account_id === yt)!;
    const m = mockFetch([() => jsonRes({ error: { message: "Invalid Credentials", code: 401 } }, 401)]);
    expect(await runTarget(t, m.fn)).toBe("action_required");
    expect(getAccount(yt)!.status).toBe("reconnect_required");
  });

  it("cancel and retry", async () => {
    const { post } = setup();
    publishPosts([post.id]);
    const t = getTargets(post.id)[0];
    expect(cancelTarget(t.id).ok).toBe(true);
    expect(getTarget(t.id)!.status).toBe("cancelled");
    expect(retryTarget(t.id).ok).toBe(true);
    expect(getTarget(t.id)!.status).toBe("queued");
    // cannot cancel while leased (upload in progress)
    claimNext();
    const leased = getTargets(post.id).find((x) => x.lease_until)!;
    expect(cancelTarget(leased.id).ok).toBe(false);
  });

  it("disabled account blocks publishing", () => {
    const { post, yt } = setup();
    db().prepare("UPDATE accounts SET status = 'disabled' WHERE id = ?").run(yt);
    const r = publishPosts([post.id]);
    expect(r.queued).toBe(1);
    expect(r.problems[0].messages.join()).toContain("отключён");
  });

  it("supports many accounts per platform (RU + DE)", () => {
    const ru = account("youtube", "YouTube RU");
    const de = account("youtube", "YouTube DE");
    expect(ru).not.toBe(de);
  });
});
