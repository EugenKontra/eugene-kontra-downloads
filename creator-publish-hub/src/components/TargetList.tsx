"use client";
import { useState } from "react";
import Link from "next/link";
import { api, Empty, fmtDate, PlatformBadge, StatusBadge } from "./ui";

export type TargetView = {
  id: string; postId: string; platform: string; accountLabel: string; postTitle: string; videoFilename?: string;
  status: string; statusLabel: string; scheduledAt: number | null; scheduledLocal: string; attempts: number;
  nextAttemptAt: number | null; url: string | null; externalId: string | null; errorCode: string | null; errorMessage: string | null;
  progress: number | null; finishedAt: number | null; updatedAt: number; uploadStarted: boolean;
};

export function TargetActions({ t, onChange }: { t: TargetView; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [when, setWhen] = useState(t.scheduledLocal);
  async function act(action: string, extra: object = {}) {
    if (action === "cancel" && !confirm("Отменить задачу?")) return;
    setBusy(true);
    try { await api(`/api/targets/${t.id}`, { method: "POST", json: { action, ...extra } }); onChange(); }
    catch (e: any) { alert(e.message); }
    finally { setBusy(false); setEditing(false); }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {["failed", "cancelled"].includes(t.status) && <button className="btn-secondary !py-1" disabled={busy} onClick={() => act("retry")}>Повторить</button>}
      {t.status === "action_required" && !t.externalId && <button className="btn-secondary !py-1" disabled={busy} onClick={() => act("retry")}>Повторить</button>}
      {["scheduled", "queued"].includes(t.status) && !editing && <button className="btn-secondary !py-1" disabled={busy} onClick={() => setEditing(true)}>Изменить время</button>}
      {editing && (
        <span className="flex items-center gap-1">
          <input type="datetime-local" className="input !w-auto !py-1" value={when} onChange={(e) => setWhen(e.target.value)} />
          <button className="btn-primary !py-1" onClick={() => act("reschedule", { scheduledLocal: when })}>OK</button>
          <button className="btn-secondary !py-1" onClick={() => act("reschedule", { scheduledLocal: "" })}>Сейчас</button>
        </span>
      )}
      {["scheduled", "queued", "cancelled"].includes(t.status) && !t.uploadStarted && <button className="btn-secondary !py-1" disabled={busy} onClick={() => act("unschedule")}>В черновик</button>}
      {["draft", "scheduled", "queued", "failed", "action_required"].includes(t.status) && <button className="btn-danger !py-1" disabled={busy} onClick={() => act("cancel")}>Отменить</button>}
    </div>
  );
}

export default function TargetList({ items, onChange, empty = "Пусто", actions = true }: { items: TargetView[] | null; onChange: () => void; empty?: string; actions?: boolean }) {
  if (!items) return <div className="text-sm text-zinc-500">Загрузка…</div>;
  if (!items.length) return <Empty>{empty}</Empty>;
  return (
    <div className="space-y-2">
      {items.map((t) => (
        <div key={t.id} className="card !p-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <PlatformBadge platform={t.platform} />
                <span className="text-sm text-zinc-300">{t.accountLabel}</span>
                <StatusBadge status={t.status} label={t.statusLabel} progress={t.progress} />
              </div>
              <Link href={`/posts/${t.postId}`} className="block truncate font-medium hover:text-violet-300">{t.postTitle || t.videoFilename || "Без названия"}</Link>
              <div className="text-xs text-zinc-500">
                {t.scheduledAt ? `План: ${fmtDate(t.scheduledAt)} (Берлин)` : "Без расписания"}
                {t.finishedAt ? ` · Завершено: ${fmtDate(t.finishedAt)}` : ""}
                {t.attempts ? ` · Попыток: ${t.attempts}` : ""}
                {t.nextAttemptAt && ["queued", "uploading", "processing"].includes(t.status) && t.nextAttemptAt > Date.now() ? ` · Следующая проверка: ${fmtDate(t.nextAttemptAt)}` : ""}
              </div>
              {t.errorMessage && <div className={`text-xs ${t.status === "action_required" ? "text-orange-300" : "text-red-300"}`}>{t.errorMessage}{t.errorCode ? ` [${t.errorCode}]` : ""}</div>}
              {t.url && <a href={t.url} target="_blank" rel="noreferrer noopener" className="text-xs text-emerald-300 underline">Открыть публикацию ↗</a>}
            </div>
            {actions && <TargetActions t={t} onChange={onChange} />}
          </div>
        </div>
      ))}
    </div>
  );
}
