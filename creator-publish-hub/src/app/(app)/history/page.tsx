"use client";
import { useState } from "react";
import TargetList from "@/components/TargetList";
import { ErrorBox, fmtDate, PlatformBadge, useApi } from "@/components/ui";

export default function HistoryPage() {
  const [tab, setTab] = useState<"results" | "log">("results");
  const results = useApi<any[]>(tab === "results" ? "/api/queue?scope=history" : null);
  const log = useApi<any[]>(tab === "log" ? "/api/events" : null, 10_000);
  return (
    <div className="space-y-4">
      <h1>История</h1>
      <div className="flex gap-2">
        <button onClick={() => setTab("results")} className={`rounded-full px-3 py-1 text-sm ${tab === "results" ? "bg-violet-600" : "bg-zinc-800"}`}>Результаты</button>
        <button onClick={() => setTab("log")} className={`rounded-full px-3 py-1 text-sm ${tab === "log" ? "bg-violet-600" : "bg-zinc-800"}`}>Журнал событий и ответов API</button>
      </div>
      {tab === "results" && <><ErrorBox>{results.error}</ErrorBox><TargetList items={results.data} onChange={results.reload} empty="История пуста" /></>}
      {tab === "log" && (
        <div className="space-y-1">
          <ErrorBox>{log.error}</ErrorBox>
          {(log.data ?? []).map((e) => (
            <details key={e.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm">
              <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                <span className="text-xs text-zinc-500">{fmtDate(e.ts)}</span>
                <span className={e.level === "error" ? "text-red-300" : e.level === "warn" ? "text-amber-300" : "text-zinc-300"}>{e.message}</span>
                {e.platform && <PlatformBadge platform={e.platform} />}{e.account_label && <span className="text-xs text-zinc-500">{e.account_label}</span>}
              </summary>
              {e.data_json && <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-xs text-zinc-400">{JSON.stringify(JSON.parse(e.data_json), null, 2)}</pre>}
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
