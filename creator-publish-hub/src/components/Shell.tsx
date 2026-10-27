"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "./ui";

const NAV = [
  ["/", "Главная", "◎"],
  ["/new", "Новая публикация", "＋"],
  ["/posts", "Все публикации", "▤"],
  ["/calendar", "Календарь", "▦"],
  ["/queue", "Очередь", "⇅"],
  ["/accounts", "Аккаунты", "◉"],
  ["/history", "История", "↺"],
  ["/settings", "Настройки", "⚙"],
] as const;

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <div className="min-h-screen md:flex">
      <aside className="sticky top-0 z-20 md:self-start border-b border-zinc-800 bg-zinc-950/95 backdrop-blur md:h-screen md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-4 py-3 md:block md:py-5">
          <Link href="/" className="text-lg font-bold tracking-tight">
            <span className="text-violet-400">Creator</span> Publish Hub
          </Link>
          <button className="text-xs text-zinc-500 hover:text-zinc-300 md:mt-1 md:block" onClick={async () => { await api("/api/auth/logout", { method: "POST" }); location.href = "/login"; }}>
            Выйти
          </button>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible md:pb-0">
          {NAV.map(([href, label, icon]) => (
            <Link key={href} href={href}
              className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm ${active(href) ? "bg-violet-600/20 text-violet-200" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"}`}>
              <span className="w-4 text-center opacity-70">{icon}</span>{label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="mx-auto w-full max-w-6xl p-4 md:p-8">{children}</main>
    </div>
  );
}
