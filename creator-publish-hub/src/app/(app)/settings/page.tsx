"use client";
import { useState } from "react";
import { api, ErrorBox, fmtDate, useApi } from "@/components/ui";

export default function SettingsPage() {
  const templates = useApi<any[]>("/api/templates");
  const dash = useApi<any>("/api/dashboard");
  const [form, setForm] = useState({ name: "", platform: "any", body: "" });
  const [err, setErr] = useState<string | null>(null);
  async function add() {
    try { await api("/api/templates", { method: "POST", json: form }); setForm({ name: "", platform: "any", body: "" }); templates.reload(); }
    catch (e: any) { setErr(e.message); }
  }
  async function del(id: string) {
    if (!confirm("Удалить шаблон?")) return;
    await api(`/api/templates/${id}`, { method: "DELETE" }); templates.reload();
  }
  return (
    <div className="space-y-6">
      <h1>Настройки</h1>
      <section className="card space-y-2 text-sm">
        <h2 className="text-lg font-semibold">Система</h2>
        <div>Часовой пояс расписания: <b>Europe/Berlin</b></div>
        <div>Фоновый воркер: {dash.data ? (dash.data.worker.alive ? <span className="text-emerald-300">работает (сигнал {fmtDate(dash.data.worker.lastHeartbeat)})</span> : <span className="text-red-300">не отвечает</span>) : "…"}</div>
        <div className="text-zinc-400">Ключи API, пароль и адрес сервера задаются в файле <code>.env</code> на сервере (см. README). Секреты не отображаются в интерфейсе.</div>
      </section>
      <section className="card space-y-3">
        <h2 className="text-lg font-semibold">Шаблоны описаний</h2>
        <ErrorBox>{err}</ErrorBox>
        <div className="grid gap-2 md:grid-cols-3">
          <input className="input" placeholder="Название шаблона" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className="input" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
            <option value="any">Для всех платформ</option><option value="youtube">YouTube</option><option value="instagram">Instagram</option><option value="tiktok">TikTok</option>
          </select>
          <button className="btn-primary" disabled={!form.name || !form.body} onClick={add}>Добавить</button>
          <textarea className="input min-h-24 md:col-span-3" placeholder="Текст шаблона, например ссылки на соцсети и постоянные хештеги" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        </div>
        {templates.data?.map((t) => (
          <div key={t.id} className="flex items-start justify-between gap-2 rounded-lg border border-zinc-800 p-2 text-sm">
            <div className="min-w-0"><div className="font-medium">{t.name} <span className="text-xs text-zinc-500">({t.platform === "any" ? "все" : t.platform})</span></div><div className="whitespace-pre-wrap text-zinc-400">{t.body}</div></div>
            <button className="btn-danger !py-1" onClick={() => del(t.id)}>Удалить</button>
          </div>
        ))}
      </section>
    </div>
  );
}
