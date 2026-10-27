"use client";
import Link from "next/link";
import TargetList from "@/components/TargetList";
import { ErrorBox, fmtDate, Notice, useApi } from "@/components/ui";

function Stat({ label, value, tone = "" }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 text-3xl font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

export default function Dashboard() {
  const { data, error, reload } = useApi<any>("/api/dashboard", 10_000);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1>Главная</h1>
        <Link href="/new" className="btn-primary">＋ Новая публикация</Link>
      </div>
      <ErrorBox>{error}</ErrorBox>
      {data && !data.worker.alive && (
        <Notice tone="warn">Фоновый обработчик (воркер) не отвечает{data.worker.lastHeartbeat ? ` с ${fmtDate(data.worker.lastHeartbeat)}` : ""}. Запланированные публикации не выполняются, пока он не запущен (<code>npm run worker</code> или контейнер <code>worker</code>).</Notice>
      )}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Аккаунты подключены" value={`${data.accounts}/${data.accountsTotal}`} />
            <Stat label="Видео загружено" value={data.videosReady} />
            <Stat label="Черновики задач" value={data.drafts} />
            <Stat label="Запланировано" value={data.scheduled} tone="text-blue-300" />
            <Stat label="В работе" value={data.active} tone="text-amber-300" />
            <Stat label="Опубликовано" value={data.published} tone="text-emerald-300" />
            <Stat label="Требуют действия" value={data.actionRequired} tone="text-orange-300" />
            <Stat label="Ошибки" value={data.failed} tone="text-red-300" />
          </div>
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Требуют внимания</h2>
            <TargetList items={data.problems} onChange={reload} empty="Ошибок нет" />
          </section>
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Ближайшие публикации</h2>
            <TargetList items={data.upcoming} onChange={reload} empty="Ничего не запланировано" />
          </section>
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Последние опубликованные</h2>
            <TargetList items={data.recent} onChange={reload} empty="Пока ничего не опубликовано" actions={false} />
          </section>
        </>
      )}
    </div>
  );
}
