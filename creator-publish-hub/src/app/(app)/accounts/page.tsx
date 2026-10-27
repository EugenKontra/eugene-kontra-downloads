"use client";
import { useEffect, useState } from "react";
import { api, ErrorBox, fmtDate, Notice, PlatformBadge, useApi } from "@/components/ui";

const SUGGESTED = ["RU", "DE"];

export default function AccountsPage() {
  const accounts = useApi<any[]>("/api/accounts");
  const platforms = useApi<any[]>("/api/platforms");
  const [flash, setFlash] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (q.get("connected")) setFlash({ tone: "ok", text: `Аккаунт подключён: ${q.get("connected")}` });
    if (q.get("error")) setFlash({ tone: "warn", text: q.get("error")! });
    if (q.size) history.replaceState(null, "", "/accounts");
  }, []);

  async function patch(id: string, body: object) {
    try { await api(`/api/accounts/${id}`, { method: "PATCH", json: body }); accounts.reload(); } catch (e: any) { alert(e.message); }
  }
  async function remove(id: string) {
    if (!confirm("Удалить аккаунт и его токены? Связанные черновики и история задач этого аккаунта тоже будут удалены.")) return;
    try { await api(`/api/accounts/${id}`, { method: "DELETE" }); accounts.reload(); } catch (e: any) { alert(e.message); }
  }

  return (
    <div className="space-y-6">
      <h1>Аккаунты</h1>
      {flash && <Notice tone={flash.tone}>{flash.text}</Notice>}
      <ErrorBox>{accounts.error ?? platforms.error}</ErrorBox>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Подключённые</h2>
        {accounts.data?.length === 0 && <Notice>Пока нет подключённых аккаунтов.</Notice>}
        {accounts.data?.map((a) => (
          <div key={a.id} className="card flex flex-col gap-3 !p-3 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2"><PlatformBadge platform={a.platform} /><span className="font-medium">{a.label}</span><span className="text-sm text-zinc-400">{a.displayName}</span></div>
              <div className="text-xs">
                {a.status === "connected" && <span className="text-emerald-300">● подключён</span>}
                {a.status === "disabled" && <span className="text-zinc-400">● отключён вами</span>}
                {a.status === "reconnect_required" && <span className="text-orange-300">● требуется переподключение — {a.statusMessage}</span>}
                <span className="text-zinc-500"> · с {fmtDate(a.createdAt)}{a.expiresAt ? ` · токен до ${fmtDate(a.expiresAt)} (обновляется автоматически)` : ""}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn-secondary !py-1" onClick={() => { const l = prompt("Название аккаунта", a.label); if (l) patch(a.id, { label: l }); }}>Переименовать</button>
              <a className="btn-secondary !py-1" href={`/api/oauth/${a.platform}/start?accountId=${a.id}&label=${encodeURIComponent(a.label)}`}>Переподключить</a>
              {a.status === "disabled"
                ? <button className="btn-secondary !py-1" onClick={() => patch(a.id, { enabled: true })}>Включить</button>
                : <button className="btn-secondary !py-1" onClick={() => patch(a.id, { enabled: false })}>Отключить</button>}
              <button className="btn-danger !py-1" onClick={() => remove(a.id)}>Удалить</button>
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Подключить новый аккаунт</h2>
        <p className="text-sm text-zinc-400">Вход выполняется на сайте платформы (OAuth). Пароли соцсетей панель не видит и не хранит. Количество аккаунтов не ограничено — например, «YouTube RU» и позже «YouTube DE».</p>
        <div className="grid gap-3 md:grid-cols-3">
          {platforms.data?.map((p) => (
            <div key={p.platform} className="card space-y-3">
              <div className="flex items-center justify-between"><PlatformBadge platform={p.platform} />{!p.configured && <span className="text-xs text-amber-300">ключи API не заданы</span>}</div>
              <p className="text-sm text-zinc-300">{p.automatic}</p>
              <ul className="list-disc space-y-1 pl-4 text-xs text-zinc-400">{p.limits.map((l: string) => <li key={l}>{l}</li>)}</ul>
              <div className="flex gap-2">
                <input className="input" placeholder={`${p.name} ${SUGGESTED[0]}`} value={labels[p.platform] ?? ""} onChange={(e) => setLabels({ ...labels, [p.platform]: e.target.value })} />
                <a aria-disabled={!p.configured}
                  className={`btn-primary shrink-0 ${p.configured ? "" : "pointer-events-none opacity-50"}`}
                  href={`/api/oauth/${p.platform}/start?label=${encodeURIComponent(labels[p.platform] || `${p.name} ${SUGGESTED[0]}`)}`}>Подключить</a>
              </div>
              <div className="break-all text-xs text-zinc-500">Redirect URI: <code>{p.redirectUri}</code></div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
