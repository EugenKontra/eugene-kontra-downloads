"use client";
import TargetList from "@/components/TargetList";
import { ErrorBox, useApi } from "@/components/ui";

export default function QueuePage() {
  const { data, error, reload } = useApi<any[]>("/api/queue?scope=active", 5000);
  const groups = [
    ["В работе", ["queued", "uploading", "processing"]],
    ["Требуют действия и ошибки", ["action_required", "failed"]],
    ["Запланировано", ["scheduled"]],
  ] as const;
  return (
    <div className="space-y-6">
      <h1>Очередь</h1>
      <p className="text-sm text-zinc-400">Задачи выполняет серверный воркер — вкладку браузера можно закрыть. Время — Europe/Berlin.</p>
      <ErrorBox>{error}</ErrorBox>
      {groups.map(([title, st]) => (
        <section key={title} className="space-y-2">
          <h2 className="text-lg font-semibold">{title}</h2>
          <TargetList items={data ? data.filter((t) => (st as readonly string[]).includes(t.status)) : null} onChange={reload} empty="Нет задач" />
        </section>
      ))}
    </div>
  );
}
