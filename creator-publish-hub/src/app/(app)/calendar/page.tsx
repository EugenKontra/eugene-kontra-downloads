"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ErrorBox, PlatformBadge, useApi } from "@/components/ui";

const TZ = "Europe/Berlin";
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const dayKey = (ms: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(new Date(ms));
const timeOf = (ms: number) => new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
const DOT: Record<string, string> = { published: "border-l-emerald-500", failed: "border-l-red-500", action_required: "border-l-orange-500", scheduled: "border-l-blue-500", draft: "border-l-zinc-500" };

export default function CalendarPage() {
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const first = new Date(cursor.y, cursor.m, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const days = useMemo(() => Array.from({ length: 42 }, (_, i) => new Date(cursor.y, cursor.m, 1 - startOffset + i, 12)), [cursor, startOffset]);
  const from = days[0].getTime() - 86400_000, to = days[41].getTime() + 86400_000;
  const { data, error } = useApi<any[]>(`/api/queue?scope=calendar&from=${from}&to=${to}`, 30_000);
  const byDay = useMemo(() => {
    const m: Record<string, any[]> = {};
    for (const t of data ?? []) { const at = t.scheduledAt ?? t.finishedAt; if (at) (m[dayKey(at)] ??= []).push({ ...t, at }); }
    return m;
  }, [data]);
  const today = dayKey(Date.now());
  const monthName = first.toLocaleString("ru-RU", { month: "long", year: "numeric" });
  const move = (n: number) => setCursor(({ y, m }) => ({ y: m + n < 0 ? y - 1 : m + n > 11 ? y + 1 : y, m: (m + n + 12) % 12 }));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1>Календарь</h1>
        <div className="flex items-center gap-2">
          <button className="btn-secondary" onClick={() => move(-1)}>←</button>
          <span className="w-44 text-center capitalize">{monthName}</span>
          <button className="btn-secondary" onClick={() => move(1)}>→</button>
        </div>
      </div>
      <p className="text-sm text-zinc-400">Часовой пояс: Europe/Berlin (летнее/зимнее время учитывается автоматически). Нажмите на задачу, чтобы изменить её.</p>
      <ErrorBox>{error}</ErrorBox>
      <div className="grid grid-cols-7 gap-1 text-xs">
        {WEEKDAYS.map((w) => <div key={w} className="px-1 text-center text-zinc-500">{w}</div>)}
        {days.map((d) => {
          const k = dayKey(d.getTime());
          const items = (byDay[k] ?? []).sort((a, b) => a.at - b.at);
          return (
            <div key={k} className={`min-h-20 rounded-md border p-1 md:min-h-28 ${d.getMonth() === cursor.m ? "border-zinc-800 bg-zinc-900/60" : "border-zinc-900 bg-zinc-950 opacity-50"} ${k === today ? "ring-1 ring-violet-500" : ""}`}>
              <div className="mb-1 text-zinc-400">{d.getDate()}</div>
              <div className="space-y-1">
                {items.map((t) => (
                  <Link key={t.id} href={`/posts/${t.postId}`} title={`${t.accountLabel}: ${t.postTitle} — ${t.statusLabel}`}
                    className={`block truncate rounded border-l-2 bg-zinc-800/80 px-1 py-0.5 hover:bg-zinc-700 ${DOT[t.status] ?? "border-l-amber-500"}`}>
                    <span className="hidden md:inline"><PlatformBadge platform={t.platform} /> </span>{timeOf(t.at)} {t.postTitle}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
