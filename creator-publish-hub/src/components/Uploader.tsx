"use client";
import { useRef, useState } from "react";
import { api, fmtBytes } from "./ui";

const CHUNK = 8 * 1024 * 1024;
const ACCEPT = ".mp4,.mov,.m4v,.webm,video/mp4,video/quicktime,video/webm";

type Item = { key: string; name: string; size: number; progress: number; status: "waiting" | "uploading" | "checking" | "done" | "error"; error?: string };

function storageKey(f: File) { return `cph-upload:${f.name}:${f.size}:${f.lastModified}`; }

async function uploadFile(file: File, onProgress: (p: number) => void): Promise<any> {
  // Resume a previously interrupted upload of the same file if the server still has it.
  let id: string | null = null;
  let offset = 0;
  try { id = localStorage.getItem(storageKey(file)); } catch { /* storage may be unavailable */ }
  if (id) {
    try { const s = await api(`/api/uploads/${id}`); if (s.status === "uploading") offset = s.offset; else id = null; }
    catch { id = null; }
  }
  if (!id) {
    const r = await api("/api/uploads", { method: "POST", json: { filename: file.name, size: file.size, type: file.type } });
    id = r.id as string;
    try { localStorage.setItem(storageKey(file), id); } catch { /* ignore */ }
  }
  let failures = 0;
  while (offset < file.size) {
    const end = Math.min(offset + CHUNK, file.size);
    try {
      const res = await fetch(`/api/uploads/${id}`, { method: "PUT", headers: { "Upload-Offset": String(offset), "Content-Type": "application/octet-stream" }, body: file.slice(offset, end) });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) { offset = data.offset; continue; }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      offset = data.offset;
      failures = 0;
      onProgress(offset / file.size);
    } catch (e) {
      if (++failures > 8) throw e;
      await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** failures)));
      const s = await api(`/api/uploads/${id}`).catch(() => null);
      if (s) offset = s.offset;
    }
  }
  const post = await api(`/api/uploads/${id}/complete`, { method: "POST" });
  try { localStorage.removeItem(storageKey(file)); } catch { /* ignore */ }
  return post;
}

export default function Uploader({ onPost }: { onPost: (post: any) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());

  function patch(key: string, p: Partial<Item>) { setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x))); }

  function add(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      const key = `${storageKey(file)}:${Math.random()}`;
      setItems((xs) => [...xs, { key, name: file.name, size: file.size, progress: 0, status: "waiting" }]);
      queue.current = queue.current.then(async () => {
        patch(key, { status: "uploading" });
        try {
          const post = await uploadFile(file, (p) => patch(key, { progress: p, status: p >= 1 ? "checking" : "uploading" }));
          patch(key, { status: "done", progress: 1 });
          onPost(post);
        } catch (e: any) {
          patch(key, { status: "error", error: e.message });
        }
      });
    }
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
        onClick={() => input.current?.click()}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition ${drag ? "border-violet-500 bg-violet-950/30" : "border-zinc-700 hover:border-zinc-500"}`}
      >
        <div className="text-lg font-medium">Перетащите видео сюда или нажмите, чтобы выбрать</div>
        <div className="mt-1 text-sm text-zinc-500">MP4, MOV, M4V, WebM · можно несколько файлов · загрузка возобновляется после обрыва</div>
        <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ""; }} />
      </div>
      {items.map((it) => (
        <div key={it.key} className="card !p-3">
          <div className="flex justify-between gap-2 text-sm">
            <span className="truncate">{it.name}</span>
            <span className="shrink-0 text-zinc-400">{fmtBytes(it.size)} · {it.status === "waiting" ? "в очереди" : it.status === "uploading" ? `${Math.round(it.progress * 100)}%` : it.status === "checking" ? "проверка видео…" : it.status === "done" ? "готово ✓" : "ошибка"}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded bg-zinc-800">
            <div className={`h-full ${it.status === "error" ? "bg-red-500" : it.status === "done" ? "bg-emerald-500" : "bg-violet-500"}`} style={{ width: `${Math.round(it.progress * 100)}%` }} />
          </div>
          {it.error && <div className="mt-1 text-xs text-red-300">{it.error}</div>}
        </div>
      ))}
    </div>
  );
}
