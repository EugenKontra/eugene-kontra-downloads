"use client";
import Link from "next/link";
import { useState } from "react";
import PublishAllButton from "@/components/PublishAllButton";
import { Empty, ErrorBox, fmtDate, PlatformBadge, StatusBadge, useApi } from "@/components/ui";

const FILTERS = [["all", "Все"], ["draft", "Черновики"], ["scheduled", "Запланированные"], ["published", "Опубликованные"], ["problem", "С ошибками"]] as const;

export default function PostsPage() {
  const { data, error, reload } = useApi<any[]>("/api/posts", 15_000);
  const [filter, setFilter] = useState<string>("all");
  const list = (data ?? []).filter((p) => {
    if (filter === "all") return true;
    if (filter === "problem") return p.targets.some((t: any) => ["failed", "action_required"].includes(t.status));
    return p.targets.some((t: any) => t.status === filter) || (filter === "draft" && p.targets.length === 0);
  });
  const hasDrafts = (data ?? []).some((p) => p.targets.some((t: any) => t.status === "draft"));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1>Все публикации</h1>
        <Link href="/new" className="btn-secondary">＋ Загрузить видео</Link>
      </div>
      {hasDrafts && <PublishAllButton onDone={reload} />}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map(([k, l]) => <button key={k} onClick={() => setFilter(k)} className={`rounded-full px-3 py-1 text-sm ${filter === k ? "bg-violet-600 text-white" : "bg-zinc-800 text-zinc-300"}`}>{l}</button>)}
      </div>
      <ErrorBox>{error}</ErrorBox>
      {data && list.length === 0 && <Empty>Публикаций нет</Empty>}
      <div className="space-y-2">
        {list.map((p) => (
          <Link key={p.id} href={`/posts/${p.id}`} className="card block !p-3 hover:border-zinc-600">
            <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <div className="truncate font-medium">{p.title || p.video?.filename || "Без названия"}</div>
                <div className="text-xs text-zinc-500">Изменено {fmtDate(p.updatedAt)}{p.video ? ` · ${p.video.filename}` : " · видео удалено"}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                {p.targets.length === 0 && <span className="text-xs text-zinc-500">аккаунты не выбраны</span>}
                {p.targets.map((t: any) => <span key={t.id} className="flex items-center gap-1"><PlatformBadge platform={t.platform} /><StatusBadge status={t.status} label={t.statusLabel} progress={t.progress} /></span>)}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
