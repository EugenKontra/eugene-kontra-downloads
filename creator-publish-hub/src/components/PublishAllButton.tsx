"use client";
import { useState } from "react";
import { saveHandlers } from "./PostEditor";
import { api, Notice } from "./ui";

/** The main button: saves open editors, then enqueues every draft task (idempotent on the server). */
export default function PublishAllButton({ postIds, onDone }: { postIds?: string[]; onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "ok" | "warn"; text: string; list: string[] } | null>(null);
  async function run() {
    if (!confirm("Опубликовать все подготовленные задачи? Публикации без времени отправятся сразу, остальные — по расписанию.")) return;
    setBusy(true); setResult(null);
    try {
      const saved = await Promise.all([...saveHandlers].map((h) => h()));
      if (saved.includes(false)) throw new Error("Не удалось сохранить изменения в одном из редакторов");
      const r = await api("/api/publish", { method: "POST", json: postIds ? { postIds } : { all: true } });
      const list = r.problems.flatMap((p: any) => p.messages);
      setResult({ tone: list.length ? "warn" : "ok", text: `В очереди: ${r.queued} · запланировано: ${r.scheduled}${r.skipped ? ` · уже обработаны ранее: ${r.skipped}` : ""}${list.length ? ` · не отправлены (${r.problems.length}):` : ""}`, list });
      onDone?.();
    } catch (e: any) {
      setResult({ tone: "warn", text: e.message, list: [] });
    } finally { setBusy(false); }
  }
  return (
    <div className="space-y-2">
      <button className="btn-primary w-full !py-3 text-base font-bold tracking-wide md:w-auto md:px-8" disabled={busy} onClick={run}>
        {busy ? "Отправка…" : "🚀 ОПУБЛИКОВАТЬ ВСЁ"}
      </button>
      {result && <Notice tone={result.tone}>{result.text}{result.list.length > 0 && <ul className="mt-1 list-disc pl-5">{result.list.map((m, i) => <li key={i}>{m}</li>)}</ul>}</Notice>}
    </div>
  );
}
