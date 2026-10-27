"use client";
import { useEffect, useMemo, useState } from "react";
import { TargetActions } from "./TargetList";
import { api, ErrorBox, fmtBytes, Notice, PLATFORM_NAMES, PlatformBadge, StatusBadge } from "./ui";

type Account = { id: string; platform: string; label: string; displayName: string | null; status: string };
type Draft = { accountId: string; scheduledLocal: string; settings: Record<string, any> };

const DEFAULTS: Record<string, Record<string, any>> = {
  youtube: { title: "", description: "", tags: [], privacy: "private", madeForKids: false, containsSyntheticMedia: false, paidPromotion: false, categoryId: "22" },
  instagram: { caption: "", hashtags: [], shareToFeed: true, coverOffsetMs: null, paidPartnership: false },
  tiktok: { caption: "", hashtags: [], privacy: "", disableComment: false, disableDuet: false, disableStitch: false, coverOffsetMs: null, brandContentToggle: false, brandOrganicToggle: false, isAigc: false, musicConsent: false, mode: "direct" },
};

/** Open editors register here so «ОПУБЛИКОВАТЬ ВСЁ» can save unsaved changes first. */
export const saveHandlers = new Set<() => Promise<boolean>>();

const splitTags = (s: string) => s.split(/[,\s]+/).map((t) => t.replace(/^#/, "").trim()).filter(Boolean);

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <div><label className="label">{label}</label>{children}{hint && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}</div>;
}
function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return <label className="flex items-start gap-2 text-sm text-zinc-300"><input type="checkbox" className="mt-0.5 accent-violet-500" checked={!!checked} onChange={(e) => onChange(e.target.checked)} /><span>{children}</span></label>;
}

function TagsInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState((value ?? []).join(" "));
  useEffect(() => { if (splitTags(text).join(" ") !== (value ?? []).join(" ")) setText((value ?? []).join(" ")); }, [value]); // eslint-disable-line
  return <input className="input" value={text} placeholder={placeholder} onChange={(e) => { setText(e.target.value); onChange(splitTags(e.target.value)); }} />;
}

function PlatformFields({ platform, s, set, templates }: { platform: string; s: Record<string, any>; set: (k: string, v: any) => void; templates: any[] }) {
  const tpl = templates.filter((t) => t.platform === "any" || t.platform === platform);
  const textKey = platform === "youtube" ? "description" : "caption";
  const TemplatePicker = tpl.length ? (
    <select className="input !w-auto !py-1 text-xs" value="" onChange={(e) => { const t = tpl.find((x) => x.id === e.target.value); if (t) set(textKey, (s[textKey] ? s[textKey] + "\n\n" : "") + t.body); }}>
      <option value="">Вставить шаблон…</option>
      {tpl.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
  ) : null;

  if (platform === "youtube") return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="md:col-span-2"><Field label={`Название (${(s.title ?? "").length}/100)`}><input className="input" maxLength={100} value={s.title ?? ""} onChange={(e) => set("title", e.target.value)} /></Field></div>
      <div className="md:col-span-2"><Field label={`Описание (${(s.description ?? "").length}/5000)`}><textarea className="input min-h-28" maxLength={5000} value={s.description ?? ""} onChange={(e) => set("description", e.target.value)} /></Field>{TemplatePicker && <div className="mt-1">{TemplatePicker}</div>}</div>
      <Field label="Теги (через пробел или запятую)"><TagsInput value={s.tags} onChange={(v) => set("tags", v)} placeholder="shorts юмор" /></Field>
      <Field label="Видимость">
        <select className="input" value={s.privacy} onChange={(e) => set("privacy", e.target.value)}>
          <option value="public">Открытый доступ</option><option value="unlisted">Доступ по ссылке</option><option value="private">Ограниченный доступ (приватное)</option>
        </select>
      </Field>
      <Field label="Аудитория">
        <select className="input" value={s.madeForKids ? "kids" : "no"} onChange={(e) => set("madeForKids", e.target.value === "kids")}>
          <option value="no">Видео не для детей</option><option value="kids">Видео для детей (COPPA)</option>
        </select>
      </Field>
      <div className="space-y-2 pt-5">
        <Check checked={s.paidPromotion} onChange={(v) => set("paidPromotion", v)}>Есть платное продвижение (реклама, спонсорство)</Check>
        <Check checked={s.containsSyntheticMedia} onChange={(v) => set("containsSyntheticMedia", v)}>Реалистичный контент, созданный или изменённый ИИ</Check>
      </div>
    </div>
  );

  if (platform === "instagram") return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="md:col-span-2"><Field label={`Подпись (${(s.caption ?? "").length}/2200)`}><textarea className="input min-h-28" value={s.caption ?? ""} onChange={(e) => set("caption", e.target.value)} /></Field>{TemplatePicker && <div className="mt-1">{TemplatePicker}</div>}</div>
      <Field label="Хештеги (до 30)"><TagsInput value={s.hashtags} onChange={(v) => set("hashtags", v)} placeholder="reels юмор" /></Field>
      <Field label="Кадр обложки, секунда" hint="Или загрузите своё изображение-обложку ниже (JPEG)"><input type="number" min={0} step={0.1} className="input" value={s.coverOffsetMs == null ? "" : s.coverOffsetMs / 1000} onChange={(e) => set("coverOffsetMs", e.target.value === "" ? null : Number(e.target.value) * 1000)} /></Field>
      <div className="space-y-2 md:col-span-2">
        <Check checked={s.shareToFeed} onChange={(v) => set("shareToFeed", v)}>Показывать Reels также в ленте профиля</Check>
        <Check checked={s.paidPartnership} onChange={(v) => set("paidPartnership", v)}>Рекламная интеграция — <span className="text-amber-300">API не ставит метку «Оплачено партнёром», добавьте её вручную в приложении после публикации</span></Check>
      </div>
    </div>
  );

  // TikTok — fields follow TikTok Content Sharing Guidelines (no default privacy, disclosures, consent).
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Field label="Режим">
        <select className="input" value={s.mode} onChange={(e) => set("mode", e.target.value)}>
          <option value="direct">Прямая публикация (Direct Post)</option>
          <option value="inbox">Отправить в черновики TikTok (завершить в приложении)</option>
        </select>
      </Field>
      {s.mode === "direct" && (
        <Field label="Кто может смотреть" hint="Без аудита приложения TikTok разрешена только «Только я»">
          <select className="input" value={s.privacy} onChange={(e) => set("privacy", e.target.value)}>
            <option value="">— выберите —</option>
            <option value="PUBLIC_TO_EVERYONE">Все</option><option value="MUTUAL_FOLLOW_FRIENDS">Друзья</option>
            <option value="FOLLOWER_OF_CREATOR">Подписчики</option><option value="SELF_ONLY">Только я</option>
          </select>
        </Field>
      )}
      <div className="md:col-span-2"><Field label={`Подпись (${(s.caption ?? "").length}/2200)`}><textarea className="input min-h-24" value={s.caption ?? ""} onChange={(e) => set("caption", e.target.value)} /></Field>{TemplatePicker && <div className="mt-1">{TemplatePicker}</div>}</div>
      <Field label="Хештеги"><TagsInput value={s.hashtags} onChange={(v) => set("hashtags", v)} placeholder="fyp юмор" /></Field>
      <Field label="Кадр обложки, секунда"><input type="number" min={0} step={0.1} className="input" value={s.coverOffsetMs == null ? "" : s.coverOffsetMs / 1000} onChange={(e) => set("coverOffsetMs", e.target.value === "" ? null : Number(e.target.value) * 1000)} /></Field>
      {s.mode === "direct" && (
        <div className="space-y-2 md:col-span-2">
          <div className="flex flex-wrap gap-4">
            <Check checked={!s.disableComment} onChange={(v) => set("disableComment", !v)}>Комментарии</Check>
            <Check checked={!s.disableDuet} onChange={(v) => set("disableDuet", !v)}>Дуэты</Check>
            <Check checked={!s.disableStitch} onChange={(v) => set("disableStitch", !v)}>Сшивки</Check>
          </div>
          <Check checked={s.brandOrganicToggle} onChange={(v) => set("brandOrganicToggle", v)}>Продвижение собственного бренда («Promotional content»)</Check>
          <Check checked={s.brandContentToggle} onChange={(v) => set("brandContentToggle", v)}>Брендированный контент (оплачено партнёром, «Paid partnership»)</Check>
          <Check checked={s.isAigc} onChange={(v) => set("isAigc", v)}>Контент создан ИИ</Check>
          <Check checked={s.musicConsent} onChange={(v) => set("musicConsent", v)}>
            Публикуя, я соглашаюсь с <a className="underline" href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer">Music Usage Confirmation</a>
            {s.brandContentToggle ? <> и <a className="underline" href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noreferrer">Branded Content Policy</a></> : null} TikTok
          </Check>
          <div className="text-xs text-zinc-500">Обработка видео в TikTok может занять несколько минут после загрузки.</div>
        </div>
      )}
    </div>
  );
}

export default function PostEditor({ postId, onPublished, compact = false }: { postId: string; onPublished?: () => void; compact?: boolean }) {
  const [post, setPost] = useState<any>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [title, setTitle] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [common, setCommon] = useState({ text: "", tags: [] as string[], when: "" });
  const [msg, setMsg] = useState<{ tone: "ok" | "warn"; text: string; list?: string[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  async function load() {
    const [p, a, t] = await Promise.all([api(`/api/posts/${postId}`), api("/api/accounts"), api("/api/templates")]);
    setPost(p); setAccounts(a); setTemplates(t); setTitle(p.title);
    const d: Record<string, Draft> = {};
    for (const tg of p.targets) d[tg.accountId] = { accountId: tg.accountId, scheduledLocal: tg.scheduledLocal, settings: tg.settings };
    setDrafts(d); setDirty(false);
  }
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [postId]); // eslint-disable-line
  // Poll while something is running.
  useEffect(() => {
    if (!post?.targets.some((t: any) => ["queued", "uploading", "processing", "scheduled"].includes(t.status))) return;
    const i = setInterval(async () => { const p = await api(`/api/posts/${postId}`).catch(() => null); if (p) setPost(p); }, 5000);
    return () => clearInterval(i);
  }, [post, postId]);

  const targetBy = useMemo(() => Object.fromEntries((post?.targets ?? []).map((t: any) => [t.accountId, t])), [post]);
  const locked = (accountId: string) => { const t = targetBy[accountId]; return t && !["draft", "scheduled", "failed", "cancelled"].includes(t.status); };

  function toggle(a: Account) {
    setDirty(true);
    setDrafts((d) => {
      const n = { ...d };
      if (n[a.id]) delete n[a.id];
      else n[a.id] = { accountId: a.id, scheduledLocal: common.when, settings: { ...DEFAULTS[a.platform], ...prefill(a.platform) } };
      return n;
    });
  }
  function prefill(platform: string) {
    if (platform === "youtube") return { title: (title || "").slice(0, 100), description: common.text, tags: common.tags };
    return { caption: common.text, hashtags: common.tags };
  }
  function applyCommon() {
    setDirty(true);
    setDrafts((d) => {
      const n: Record<string, Draft> = {};
      for (const [id, dr] of Object.entries(d)) {
        const acc = accounts.find((a) => a.id === id);
        if (!acc || locked(id)) { n[id] = dr; continue; }
        n[id] = { ...dr, scheduledLocal: common.when || dr.scheduledLocal, settings: { ...dr.settings, ...prefill(acc.platform) } };
      }
      return n;
    });
  }
  function setField(accountId: string, k: string, v: any) {
    setDirty(true);
    setDrafts((d) => ({ ...d, [accountId]: { ...d[accountId], settings: { ...d[accountId].settings, [k]: v } } }));
  }

  async function save(): Promise<boolean> {
    setBusy(true); setErr(null);
    try {
      const p = await api(`/api/posts/${postId}`, { method: "PUT", json: { title, targets: Object.values(drafts).map((d) => ({ accountId: d.accountId, scheduledLocal: d.scheduledLocal || null, settings: d.settings })) } });
      setPost(p); setDirty(false);
      return true;
    } catch (e: any) { setErr(e.message); return false; }
    finally { setBusy(false); }
  }

  useEffect(() => {
    const h = () => (dirty ? save() : Promise.resolve(true));
    saveHandlers.add(h);
    return () => { saveHandlers.delete(h); };
  });

  async function publish() {
    if (!(await save())) return;
    setBusy(true);
    try {
      const r = await api("/api/publish", { method: "POST", json: { postIds: [postId] } });
      const list = r.problems.flatMap((p: any) => p.messages);
      setMsg({ tone: list.length ? "warn" : "ok", text: `Поставлено в очередь: ${r.queued}, запланировано: ${r.scheduled}${r.skipped ? `, пропущено (уже в работе/готово): ${r.skipped}` : ""}${list.length ? ". Не отправлено из-за ошибок:" : ""}`, list });
      await load();
      onPublished?.();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function uploadCover(targetId: string, file: File) {
    const fd = new FormData(); fd.append("file", file);
    try { await api(`/api/targets/${targetId}/cover`, { method: "POST", body: fd }); await load(); setMsg({ tone: "ok", text: "Обложка загружена" }); }
    catch (e: any) { setErr(e.message); }
  }

  async function remove() {
    if (!confirm("Удалить публикацию (задачи и настройки)? Видеофайл останется, его можно удалить отдельно.")) return;
    try { await api(`/api/posts/${postId}`, { method: "DELETE" }); location.href = "/posts"; } catch (e: any) { setErr(e.message); }
  }
  async function removeVideo() {
    if (!post?.video || !confirm("Удалить видеофайл с сервера?")) return;
    try { await api(`/api/videos/${post.video.id}`, { method: "DELETE" }); await load(); } catch (e: any) { setErr(e.message); }
  }

  if (err && !post) return <ErrorBox>{err}</ErrorBox>;
  if (!post) return <div className="text-sm text-zinc-500">Загрузка…</div>;
  const v = post.video;
  const usable = accounts.filter((a) => a.status !== "disabled" || drafts[a.id]);

  return (
    <div className="card space-y-4">
      <div className="flex flex-col gap-4 md:flex-row">
        {v?.status === "ready" && !compact && <video src={`/api/videos/${v.id}`} controls preload="metadata" className="max-h-80 w-full rounded-lg bg-black md:w-48" />}
        <div className="min-w-0 flex-1 space-y-3">
          <Field label="Внутреннее название публикации"><input className="input" value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} /></Field>
          {v ? (
            <div className="text-xs text-zinc-400">
              {v.filename} · {fmtBytes(v.size)}
              {v.meta && <> · {v.meta.width}×{v.meta.height} · {v.meta.durationSec.toFixed(1)} с · {v.meta.videoCodec}/{v.meta.audioCodec ?? "без звука"} · {Math.round(v.meta.fps)} fps</>}
              {!compact && <button className="ml-2 text-red-400 hover:underline" onClick={removeVideo}>удалить файл</button>}
            </div>
          ) : <Notice tone="warn">Видео не прикреплено (удалено).</Notice>}
          {v?.compatibility && (
            <div className="grid gap-1 text-xs md:grid-cols-3">
              {Object.entries(v.compatibility).map(([p, issues]: any) => (
                <div key={p} className="rounded-md bg-zinc-950 p-2">
                  <div className="mb-1 font-medium">{PLATFORM_NAMES[p]}: {issues.some((i: any) => i.level === "error") ? <span className="text-red-300">не подходит</span> : <span className="text-emerald-300">подходит</span>}</div>
                  {issues.map((i: any, k: number) => <div key={k} className={i.level === "error" ? "text-red-300" : "text-amber-300"}>• {i.message}</div>)}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div>
        <div className="label">Аккаунты</div>
        {usable.length === 0 && <Notice tone="warn">Нет подключённых аккаунтов. Откройте раздел «Аккаунты».</Notice>}
        <div className="flex flex-wrap gap-2">
          {usable.map((a) => (
            <button key={a.id} onClick={() => !locked(a.id) && toggle(a)} disabled={locked(a.id)}
              className={`rounded-lg border px-3 py-2 text-sm ${drafts[a.id] ? "border-violet-500 bg-violet-600/20" : "border-zinc-700 hover:border-zinc-500"} ${a.status !== "connected" ? "opacity-60" : ""}`}>
              {drafts[a.id] ? "✓ " : ""}{a.label} <span className="text-xs text-zinc-400">({PLATFORM_NAMES[a.platform]}{a.status !== "connected" ? ", не активен" : ""})</span>
            </button>
          ))}
        </div>
      </div>

      {Object.keys(drafts).length > 0 && (
        <details className="rounded-lg border border-zinc-800 p-3" open={!compact}>
          <summary className="cursor-pointer text-sm font-medium">Общий текст и время для всех выбранных платформ</summary>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="md:col-span-3"><Field label="Общее описание / подпись"><textarea className="input min-h-20" value={common.text} onChange={(e) => setCommon({ ...common, text: e.target.value })} /></Field></div>
            <Field label="Общие хештеги"><TagsInput value={common.tags} onChange={(t) => setCommon({ ...common, tags: t })} /></Field>
            <Field label="Время публикации (Берлин)" hint="Пусто — сразу после нажатия «Опубликовать»"><input type="datetime-local" className="input" value={common.when} onChange={(e) => setCommon({ ...common, when: e.target.value })} /></Field>
            <div className="flex items-end"><button className="btn-secondary w-full" onClick={applyCommon}>Применить ко всем</button></div>
          </div>
        </details>
      )}

      {Object.values(drafts).map((d) => {
        const acc = accounts.find((a) => a.id === d.accountId);
        if (!acc) return null;
        const t = targetBy[d.accountId];
        const isLocked = locked(d.accountId);
        return (
          <div key={d.accountId} className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2"><PlatformBadge platform={acc.platform} /><span className="font-medium">{acc.label}</span>{acc.displayName && <span className="text-xs text-zinc-500">{acc.displayName}</span>}{t && <StatusBadge status={t.status} label={t.statusLabel} progress={t.progress} />}</div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500">Время (Берлин):</span>
                <input type="datetime-local" disabled={isLocked || (t && t.status !== "draft")} className="input !w-auto !py-1" value={d.scheduledLocal} onChange={(e) => { setDirty(true); setDrafts((x) => ({ ...x, [d.accountId]: { ...x[d.accountId], scheduledLocal: e.target.value } })); }} />
              </div>
            </div>
            {t?.errorMessage && <div className={`text-sm ${t.status === "action_required" ? "text-orange-300" : "text-red-300"}`}>{t.errorMessage}</div>}
            {t?.url && <a className="text-sm text-emerald-300 underline" href={t.url} target="_blank" rel="noreferrer noopener">Открыть публикацию ↗</a>}
            {t && t.status !== "draft" && <TargetActions t={t} onChange={load} />}
            <fieldset disabled={isLocked} className={isLocked ? "opacity-60" : ""}>
              <PlatformFields platform={acc.platform} s={d.settings} set={(k, val) => setField(d.accountId, k, val)} templates={templates} />
              {t && acc.platform !== "tiktok" && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                  <span className="label !mb-0">Своя обложка</span>
                  {(t.settings.coverPath || t.settings.coverVideoPath) ? <span className="text-emerald-300">загружена</span> : <span className="text-zinc-500">нет</span>}
                  <input type="file" accept={acc.platform === "instagram" ? "image/jpeg" : "image/jpeg,image/png"} className="text-xs" onChange={(e) => e.target.files?.[0] && uploadCover(t.id, e.target.files[0])} />
                  {acc.platform === "youtube" && <span className="text-xs text-zinc-500">JPEG/PNG до 2 МБ, канал должен быть подтверждён</span>}
                </div>
              )}
            </fieldset>
          </div>
        );
      })}

      <ErrorBox>{err}</ErrorBox>
      {msg && <Notice tone={msg.tone}>{msg.text}{msg.list?.length ? <ul className="mt-1 list-disc pl-5">{msg.list.map((m, i) => <li key={i}>{m}</li>)}</ul> : null}</Notice>}

      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary" disabled={busy || !dirty} onClick={save}>{dirty ? "Сохранить черновик" : "Сохранено"}</button>
        <button className="btn-primary" disabled={busy || Object.keys(drafts).length === 0} onClick={publish}>Опубликовать эту публикацию</button>
        {!compact && <button className="btn-danger ml-auto" onClick={remove}>Удалить</button>}
      </div>
    </div>
  );
}
