import { db, kvGet } from "./db";
import { formatBerlin, utcToBerlinLocal } from "./time";
import { STATUS_LABELS } from "./platforms/types";
import { compatibility, getVideo, videoMeta } from "./videos";
import { getTargets, type PostRow, type TargetRow } from "./posts";

export function targetView(t: TargetRow & { platform?: string; account_label?: string; post_title?: string; video_filename?: string }) {
  const state = JSON.parse(t.state_json || "{}");
  return {
    id: t.id, postId: t.post_id, accountId: t.account_id,
    platform: t.platform, accountLabel: t.account_label, postTitle: t.post_title, videoFilename: t.video_filename,
    settings: JSON.parse(t.settings_json),
    status: t.status, statusLabel: STATUS_LABELS[t.status],
    scheduledAt: t.scheduled_at, scheduledLocal: t.scheduled_at ? utcToBerlinLocal(t.scheduled_at) : "",
    scheduledText: formatBerlin(t.scheduled_at),
    attempts: t.attempts, nextAttemptAt: t.next_attempt_at,
    externalId: t.external_id, url: t.url, errorCode: t.error_code, errorMessage: t.error_message,
    progress: t.progress, startedAt: t.started_at, finishedAt: t.finished_at, updatedAt: t.updated_at,
    uploadStarted: Object.keys(state).length > 0,
  };
}

const TARGET_JOIN = `
  SELECT t.*, a.platform, a.label AS account_label, p.title AS post_title, v.filename AS video_filename
  FROM targets t JOIN accounts a ON a.id = t.account_id JOIN posts p ON p.id = t.post_id LEFT JOIN videos v ON v.id = p.video_id`;

export function listTargets(where = "1=1", params: unknown[] = [], order = "t.updated_at DESC", limit = 500) {
  return (db().prepare(`${TARGET_JOIN} WHERE ${where} ORDER BY ${order} LIMIT ${limit}`).all(...params) as any[]).map(targetView);
}

export function postView(p: PostRow) {
  const video = p.video_id ? getVideo(p.video_id) : undefined;
  const targets = getTargets(p.id).map((t) => targetView(db().prepare(`${TARGET_JOIN} WHERE t.id = ?`).get(t.id) as any));
  return {
    id: p.id, title: p.title, createdAt: p.created_at, updatedAt: p.updated_at,
    video: video ? {
      id: video.id, filename: video.filename, size: video.size, status: video.status,
      meta: videoMeta(video), compatibility: video.status === "ready" ? compatibility(video) : null,
    } : null,
    targets,
  };
}

export function dashboard() {
  const d = db();
  const count = (sql: string, ...p: unknown[]) => (d.prepare(sql).get(...p) as { n: number }).n;
  const hb = Number(kvGet("worker_heartbeat") ?? 0);
  return {
    accounts: count("SELECT COUNT(*) n FROM accounts WHERE status = 'connected'"),
    accountsTotal: count("SELECT COUNT(*) n FROM accounts"),
    videosReady: count("SELECT COUNT(*) n FROM videos WHERE status = 'ready'"),
    drafts: count("SELECT COUNT(*) n FROM targets WHERE status = 'draft'"),
    scheduled: count("SELECT COUNT(*) n FROM targets WHERE status = 'scheduled'"),
    active: count("SELECT COUNT(*) n FROM targets WHERE status IN ('queued','uploading','processing')"),
    published: count("SELECT COUNT(*) n FROM targets WHERE status = 'published'"),
    actionRequired: count("SELECT COUNT(*) n FROM targets WHERE status = 'action_required'"),
    failed: count("SELECT COUNT(*) n FROM targets WHERE status = 'failed'"),
    recent: listTargets("t.status = 'published'", [], "t.finished_at DESC", 8),
    upcoming: listTargets("t.status = 'scheduled'", [], "t.scheduled_at ASC", 8),
    problems: listTargets("t.status IN ('failed','action_required')", [], "t.updated_at DESC", 8),
    worker: { lastHeartbeat: hb || null, alive: Date.now() - hb < 60_000 },
  };
}
