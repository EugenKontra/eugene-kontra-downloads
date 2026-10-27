"use client";
import { useCallback, useEffect, useState } from "react";

export const PLATFORM_NAMES: Record<string, string> = { youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok" };
const PLATFORM_COLORS: Record<string, string> = {
  youtube: "bg-red-600/20 text-red-300 border-red-700/50",
  instagram: "bg-pink-600/20 text-pink-300 border-pink-700/50",
  tiktok: "bg-cyan-600/20 text-cyan-200 border-cyan-700/50",
};
const STATUS_COLORS: Record<string, string> = {
  draft: "bg-zinc-700/40 text-zinc-300",
  scheduled: "bg-blue-600/20 text-blue-300",
  queued: "bg-indigo-600/20 text-indigo-300",
  uploading: "bg-amber-600/20 text-amber-300",
  processing: "bg-amber-600/20 text-amber-200",
  published: "bg-emerald-600/20 text-emerald-300",
  action_required: "bg-orange-600/25 text-orange-300",
  failed: "bg-red-600/25 text-red-300",
  cancelled: "bg-zinc-800 text-zinc-500",
};

export function PlatformBadge({ platform }: { platform?: string }) {
  if (!platform) return null;
  return <span className={`inline-block rounded-md border px-2 py-0.5 text-xs font-medium ${PLATFORM_COLORS[platform] ?? ""}`}>{PLATFORM_NAMES[platform] ?? platform}</span>;
}

export function StatusBadge({ status, label, progress }: { status: string; label: string; progress?: number | null }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status] ?? ""}`}>
      {label}{status === "uploading" && progress != null ? ` ${Math.round(progress * 100)}%` : ""}
    </span>
  );
}

export function fmtDate(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" }).format(new Date(ms));
}

export function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} ГБ`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} МБ`;
  return `${Math.round(n / 1024)} КБ`;
}

export async function api<T = any>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.json !== undefined ? { "Content-Type": "application/json", ...init?.headers } : init?.headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  if (res.status === 401) { window.location.href = "/login"; throw new Error("Требуется вход"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Ошибка ${res.status}`);
  return data;
}

/** Loads JSON and optionally polls it. */
export function useApi<T>(url: string | null, pollMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!url) return;
    try { setData(await api<T>(url)); setError(null); } catch (e: any) { setError(e.message); }
  }, [url]);
  useEffect(() => {
    reload();
    if (!pollMs) return;
    const t = setInterval(reload, pollMs);
    return () => clearInterval(t);
  }, [reload, pollMs]);
  return { data, error, reload, setData };
}

export function ErrorBox({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return <div className="rounded-lg border border-red-900 bg-red-950/60 p-3 text-sm text-red-200">{children}</div>;
}

export function Notice({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warn" | "ok" }) {
  const c = tone === "warn" ? "border-amber-800 bg-amber-950/50 text-amber-200" : tone === "ok" ? "border-emerald-800 bg-emerald-950/50 text-emerald-200" : "border-zinc-700 bg-zinc-900 text-zinc-300";
  return <div className={`rounded-lg border p-3 text-sm ${c}`}>{children}</div>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-sm text-zinc-500">{children}</div>;
}
