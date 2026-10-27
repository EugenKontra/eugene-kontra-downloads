import { db } from "./db";
import { newId } from "./crypto";
import { getAccount } from "./accounts";
import { adapter } from "./platforms/registry";
import { defaultSettings, type TargetStatus } from "./platforms/types";
import { compatibility, getVideo } from "./videos";
import type { Platform } from "./platforms/specs";

export type TargetRow = {
  id: string; post_id: string; account_id: string; settings_json: string; scheduled_at: number | null;
  status: TargetStatus; attempts: number; next_attempt_at: number | null; lease_until: number | null;
  state_json: string; external_id: string | null; url: string | null; error_code: string | null;
  error_message: string | null; progress: number | null; started_at: number | null; finished_at: number | null;
  created_at: number; updated_at: number;
};
export type PostRow = { id: string; video_id: string | null; title: string; created_at: number; updated_at: number };

export const EDITABLE: TargetStatus[] = ["draft", "scheduled", "failed", "cancelled"];
export const ACTIVE: TargetStatus[] = ["queued", "uploading", "processing"];

export function createPost(videoId: string | null, title = ""): PostRow {
  const id = newId();
  const now = Date.now();
  db().prepare("INSERT INTO posts(id, video_id, title, created_at, updated_at) VALUES(?, ?, ?, ?, ?)").run(id, videoId, title, now, now);
  return getPost(id)!;
}

export function getPost(id: string): PostRow | undefined {
  return db().prepare("SELECT * FROM posts WHERE id = ?").get(id) as PostRow | undefined;
}

export function getTargets(postId: string): TargetRow[] {
  return db().prepare("SELECT * FROM targets WHERE post_id = ? ORDER BY created_at").all(postId) as TargetRow[];
}

export function getTarget(id: string): TargetRow | undefined {
  return db().prepare("SELECT * FROM targets WHERE id = ?").get(id) as TargetRow | undefined;
}

export type TargetInput = { accountId: string; settings: Record<string, unknown>; scheduledAt: number | null };

/**
 * Saves the draft: title + set of targets. Targets that are already running/published are never touched;
 * removed accounts delete only editable targets.
 */
export function saveDraft(postId: string, title: string, targets: TargetInput[]) {
  const d = db();
  d.transaction(() => {
    d.prepare("UPDATE posts SET title = ?, updated_at = ? WHERE id = ?").run(title, Date.now(), postId);
    const existing = getTargets(postId);
    const wanted = new Set(targets.map((t) => t.accountId));
    for (const t of existing) {
      if (!wanted.has(t.account_id) && (t.status === "draft" || t.status === "cancelled")) d.prepare("DELETE FROM targets WHERE id = ?").run(t.id);
    }
    for (const input of targets) {
      const account = getAccount(input.accountId);
      if (!account) continue;
      const cur = existing.find((t) => t.account_id === input.accountId);
      const settings = { ...defaultSettings(account.platform), ...input.settings };
      const now = Date.now();
      if (!cur) {
        d.prepare("INSERT INTO targets(id, post_id, account_id, settings_json, scheduled_at, status, created_at, updated_at) VALUES(?, ?, ?, ?, ?, 'draft', ?, ?)")
          .run(newId(), postId, input.accountId, JSON.stringify(settings), input.scheduledAt, now, now);
      } else if (EDITABLE.includes(cur.status)) {
        d.prepare("UPDATE targets SET settings_json = ?, scheduled_at = ?, updated_at = ? WHERE id = ?")
          .run(JSON.stringify(settings), input.scheduledAt, now, cur.id);
      }
    }
  })();
}

export function deletePost(postId: string): { ok: boolean; reason?: string } {
  const active = getTargets(postId).some((t) => ACTIVE.includes(t.status));
  if (active) return { ok: false, reason: "Есть задачи в процессе публикации — дождитесь завершения" };
  db().prepare("DELETE FROM posts WHERE id = ?").run(postId);
  return { ok: true };
}

/** Pre-flight checks for one target. Returns list of problems (empty = ready). */
export function checkTarget(t: TargetRow, post: PostRow): string[] {
  const problems: string[] = [];
  const account = getAccount(t.account_id);
  if (!account) return ["Аккаунт удалён"];
  const name = `${account.label}`;
  const a = adapter(account.platform as Platform);
  if (!a.isConfigured()) problems.push(`${name}: ключи API платформы не настроены на сервере`);
  if (account.status !== "connected") problems.push(`${name}: аккаунт ${account.status === "disabled" ? "отключён" : "требует переподключения"}`);
  const video = post.video_id ? getVideo(post.video_id) : undefined;
  if (!video) problems.push(`${name}: видео не выбрано`);
  else if (video.status !== "ready") problems.push(`${name}: видео ещё не загружено или не прошло проверку`);
  else for (const i of compatibility(video)[account.platform as Platform]) if (i.level === "error") problems.push(`${name}: ${i.message}`);
  for (const p of a.validate(JSON.parse(t.settings_json))) problems.push(`${name} — ${p}`);
  return problems;
}

/**
 * «Опубликовать всё». Idempotent: only targets in "draft" are moved, using a conditional UPDATE,
 * so repeated clicks (or parallel requests) never enqueue the same target twice.
 */
export function publishPosts(postIds: string[], now = Date.now()) {
  const d = db();
  const result = { queued: 0, scheduled: 0, skipped: 0, problems: [] as { postId: string; targetId: string; messages: string[] }[] };
  for (const postId of postIds) {
    const post = getPost(postId);
    if (!post) continue;
    for (const t of getTargets(postId)) {
      if (t.status !== "draft") { result.skipped++; continue; }
      const problems = checkTarget(t, post);
      if (problems.length) { result.problems.push({ postId, targetId: t.id, messages: problems }); continue; }
      const scheduled = t.scheduled_at != null && t.scheduled_at > now;
      const r = d.prepare("UPDATE targets SET status = ?, next_attempt_at = ?, error_code = NULL, error_message = NULL, updated_at = ? WHERE id = ? AND status = 'draft'")
        .run(scheduled ? "scheduled" : "queued", scheduled ? t.scheduled_at : now, now, t.id);
      if (r.changes === 1) scheduled ? result.scheduled++ : result.queued++;
      else result.skipped++;
    }
  }
  return result;
}

export type ActionResult = { ok: boolean; reason?: string };

export function cancelTarget(id: string): ActionResult {
  const now = Date.now();
  const r = db().prepare("UPDATE targets SET status = 'cancelled', updated_at = ? WHERE id = ? AND status IN ('draft','scheduled','queued','failed','action_required') AND COALESCE(lease_until, 0) < ?").run(now, id, now);
  return r.changes ? { ok: true } : { ok: false, reason: "Задачу нельзя отменить: загрузка уже идёт или публикация завершена" };
}

/** Retry keeps state_json so uploads resume (and an already-uploaded video is not uploaded again). */
export function retryTarget(id: string): ActionResult {
  const t = getTarget(id);
  if (!t) return { ok: false, reason: "Задача не найдена" };
  if (!["failed", "cancelled", "action_required"].includes(t.status)) return { ok: false, reason: "Повторить можно только неудачную или отменённую задачу" };
  if (t.status === "action_required" && t.external_id) return { ok: false, reason: "Видео уже отправлено на платформу — завершите действие в приложении" };
  const post = getPost(t.post_id)!;
  const problems = checkTarget(t, post);
  if (problems.length) return { ok: false, reason: problems.join("; ") };
  db().prepare("UPDATE targets SET status = 'queued', next_attempt_at = ?, error_code = NULL, error_message = NULL, attempts = 0, updated_at = ? WHERE id = ? AND status = ?")
    .run(Date.now(), Date.now(), id, t.status);
  return { ok: true };
}

export function rescheduleTarget(id: string, scheduledAt: number | null): ActionResult {
  const t = getTarget(id);
  if (!t) return { ok: false, reason: "Задача не найдена" };
  if (!["draft", "scheduled", "queued"].includes(t.status)) return { ok: false, reason: "Время можно изменить только до начала загрузки" };
  const now = Date.now();
  if (t.status === "draft") {
    db().prepare("UPDATE targets SET scheduled_at = ?, updated_at = ? WHERE id = ?").run(scheduledAt, now, id);
  } else {
    const future = scheduledAt != null && scheduledAt > now;
    db().prepare("UPDATE targets SET scheduled_at = ?, status = ?, next_attempt_at = ?, updated_at = ? WHERE id = ? AND status IN ('scheduled','queued')")
      .run(scheduledAt, future ? "scheduled" : "queued", future ? scheduledAt : now, now, id);
  }
  return { ok: true };
}

/** Return a scheduled/cancelled task to draft for editing. */
export function unscheduleTarget(id: string): ActionResult {
  const r = db().prepare("UPDATE targets SET status = 'draft', updated_at = ? WHERE id = ? AND status IN ('scheduled','queued','cancelled') AND (state_json = '{}' OR state_json IS NULL)").run(Date.now(), id);
  return r.changes ? { ok: true } : { ok: false, reason: "Задачу нельзя вернуть в черновик (загрузка уже начиналась)" };
}
