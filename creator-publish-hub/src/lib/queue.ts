import { db, kvSet } from "./db";
import { getAccessToken, getAccount, setAccountStatus } from "./accounts";
import { logEvent } from "./events";
import { adapter } from "./platforms/registry";
import { PlatformError, type StepContext, type TargetStatus } from "./platforms/types";
import { getPost, getTarget, type TargetRow } from "./posts";
import { getVideo, videoMeta } from "./videos";
import type { Platform } from "./platforms/specs";

export const LEASE_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 6;

export function backoffMs(attempt: number): number {
  return Math.min(60 * 60_000, 60_000 * 2 ** Math.max(0, attempt - 1));
}

/** Moves due scheduled targets to the queue. Returns number promoted. */
export function promoteDue(now = Date.now()): number {
  return db().prepare("UPDATE targets SET status = 'queued', next_attempt_at = ?, updated_at = ? WHERE status = 'scheduled' AND scheduled_at <= ?").run(now, now, now).changes;
}

/** Atomically claims one due target with a lease. */
export function claimNext(now = Date.now()): TargetRow | null {
  const d = db();
  return d.transaction(() => {
    const row = d.prepare(`
      SELECT id FROM targets
      WHERE status IN ('queued','uploading','processing') AND COALESCE(next_attempt_at, 0) <= ? AND COALESCE(lease_until, 0) < ?
      ORDER BY COALESCE(next_attempt_at, 0) LIMIT 1`).get(now, now) as { id: string } | undefined;
    if (!row) return null;
    const r = d.prepare("UPDATE targets SET lease_until = ?, started_at = COALESCE(started_at, ?) WHERE id = ? AND COALESCE(lease_until, 0) < ?").run(now + LEASE_MS, now, row.id, now);
    return r.changes ? getTarget(row.id)! : null;
  }).immediate();
}

/** On worker start: leases from a previous (crashed) worker process are released. Single worker assumed. */
export function releaseAllLeases() {
  return db().prepare("UPDATE targets SET lease_until = NULL WHERE lease_until IS NOT NULL").run().changes;
}

function update(id: string, fields: Partial<Record<keyof TargetRow, unknown>>) {
  const keys = Object.keys(fields);
  db().prepare(`UPDATE targets SET ${keys.map((k) => `${k} = @${k}`).join(", ")}, updated_at = @__now WHERE id = @__id`)
    .run({ ...fields, __now: Date.now(), __id: id });
}

/** Executes one step for a claimed target and records the outcome. Never throws. */
export async function runTarget(t: TargetRow, fetchFn: typeof fetch = fetch): Promise<TargetStatus> {
  const fail = (status: TargetStatus, code: string, message: string, extra: Partial<Record<keyof TargetRow, unknown>> = {}) => {
    update(t.id, { status, error_code: code, error_message: message, lease_until: null, finished_at: status === "failed" ? Date.now() : null, ...extra });
    logEvent(t.id, "error", message, { code });
    return status;
  };
  try {
    const account = getAccount(t.account_id);
    if (!account) return fail("failed", "account_deleted", "Аккаунт удалён");
    if (account.status !== "connected") return fail("action_required", "account_unavailable", `Аккаунт «${account.label}» отключён или требует переподключения`);
    const post = getPost(t.post_id);
    const video = post?.video_id ? getVideo(post.video_id) : undefined;
    if (!video || video.status !== "ready") return fail("failed", "video_missing", "Видео не найдено или не готово");

    const a = adapter(account.platform as Platform);
    if (t.status === "queued") {
      update(t.id, { status: "uploading", attempts: t.attempts + 1 });
      logEvent(t.id, "info", `Старт публикации (${account.label}), попытка ${t.attempts + 1}`);
    }
    const token = await getAccessToken(account);
    let state = JSON.parse(t.state_json || "{}");
    const ctx: StepContext = {
      targetId: t.id,
      account: { id: account.id, externalId: account.external_id, displayName: account.display_name, options: JSON.parse(account.options_json || "{}") },
      accessToken: token,
      settings: JSON.parse(t.settings_json),
      scheduledAt: t.scheduled_at,
      video: { id: video.id, path: video.stored_path, size: video.size, mime: video.mime, filename: video.filename, durationSec: videoMeta(video)?.durationSec ?? 0 },
      state,
      saveState: (s) => { state = s; update(t.id, { state_json: JSON.stringify(s), lease_until: Date.now() + LEASE_MS }); },
      progress: (f) => update(t.id, { progress: Math.round(f * 1000) / 1000, lease_until: Date.now() + LEASE_MS }),
      log: (m, data) => logEvent(t.id, "info", m, data),
      fetch: fetchFn,
    };
    const r = await a.step(ctx);
    if (r.kind === "continue") {
      update(t.id, { status: r.status, state_json: JSON.stringify(r.state), next_attempt_at: Date.now() + r.delayMs, lease_until: null });
      return r.status;
    }
    update(t.id, {
      status: r.status, state_json: JSON.stringify(r.state), external_id: r.externalId ?? null, url: r.url ?? null,
      error_code: null, error_message: r.status === "action_required" ? r.message ?? null : null,
      progress: 1, finished_at: Date.now(), lease_until: null,
    });
    logEvent(t.id, r.status === "published" ? "info" : "warn", r.message ?? r.status, { url: r.url, externalId: r.externalId });
    return r.status;
  } catch (e: any) {
    const err = e instanceof PlatformError ? e : new PlatformError(String(e?.message ?? e), "internal", false);
    const fresh = getTarget(t.id)!;
    if (err.authError) {
      setAccountStatus(t.account_id, "reconnect_required", err.message);
      return fail("action_required", err.code, `Требуется переподключить аккаунт: ${err.message}`);
    }
    if (err.retryable && fresh.attempts < MAX_ATTEMPTS) {
      const delay = backoffMs(fresh.attempts);
      update(t.id, { error_code: err.code, error_message: err.message, next_attempt_at: Date.now() + delay, lease_until: null, attempts: fresh.attempts + 1 });
      logEvent(t.id, "warn", `${err.message} — повтор через ${Math.round(delay / 60_000)} мин`, err.details);
      return fresh.status;
    }
    logEvent(t.id, "error", err.message, err.details);
    return fail("failed", err.code, err.message);
  }
}

export function heartbeat() {
  kvSet("worker_heartbeat", String(Date.now()));
}
