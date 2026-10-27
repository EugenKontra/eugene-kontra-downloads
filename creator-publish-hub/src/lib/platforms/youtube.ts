import crypto from "node:crypto";
import fs from "node:fs";
import { env } from "../config";
import { form, readChunk, requestJson } from "./http";
import { PlatformError, type PlatformAdapter, type StepContext, type StepResult, type YouTubeSettings } from "./types";

const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"];
const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/youtube/v3";
/** Must be a multiple of 256 KiB. */
export const YT_CHUNK = 32 * 1024 * 1024;

function challenge(verifier: string) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export const youtube: PlatformAdapter = {
  platform: "youtube",
  capabilities: {
    automatic: "Полностью автоматическая публикация (публично, по ссылке или приватно).",
    limits: [
      "Квота: до 100 загрузок в сутки на проект Google Cloud (отдельная квота Video Uploads).",
      "Пользовательская обложка — только для подтверждённых по телефону каналов.",
      "Пока приложение Google в режиме «Testing», доступ истекает через 7 дней — переведите его в «In production».",
    ],
  },
  isConfigured: () => !!env("GOOGLE_CLIENT_ID") && !!env("GOOGLE_CLIENT_SECRET"),

  authorizeUrl(state, redirectUri, verifier) {
    const p = new URLSearchParams({
      client_id: env("GOOGLE_CLIENT_ID"), redirect_uri: redirectUri, response_type: "code",
      scope: SCOPES.join(" "), access_type: "offline", prompt: "consent select_account",
      include_granted_scopes: "true", state, code_challenge: challenge(verifier), code_challenge_method: "S256",
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  },

  async exchangeCode(code, redirectUri, verifier) {
    const { body } = await requestJson(fetch, "https://oauth2.googleapis.com/token", {
      method: "POST",
      body: form({ code, client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"), redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: verifier }),
    }, "Google OAuth");
    if (!String(body.scope ?? "").includes("youtube.upload")) {
      throw new PlatformError("Не выдано разрешение на загрузку видео (youtube.upload). Подключите аккаунт ещё раз и отметьте все галочки.", "missing_scope", false);
    }
    return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: Date.now() + body.expires_in * 1000, scopes: body.scope };
  },

  async fetchProfile(tokens) {
    const { body } = await requestJson(fetch, `${API}/channels?part=snippet&mine=true`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    }, "YouTube");
    const ch = body.items?.[0];
    if (!ch) throw new PlatformError("У этого Google-аккаунта нет YouTube-канала", "no_channel", false);
    return { externalId: ch.id, displayName: ch.snippet?.title ?? ch.id };
  },

  async refresh(refreshToken) {
    if (!refreshToken) throw new PlatformError("Нет refresh token — подключите аккаунт заново", "no_refresh", false, undefined, true);
    const { body } = await requestJson(fetch, "https://oauth2.googleapis.com/token", {
      method: "POST",
      body: form({ client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"), refresh_token: refreshToken, grant_type: "refresh_token" }),
    }, "Google OAuth").catch((e: PlatformError) => {
      if (e.code === "invalid_grant") e.authError = true;
      throw e;
    });
    return { accessToken: body.access_token, refreshToken, expiresAt: Date.now() + body.expires_in * 1000, scopes: body.scope };
  },

  validate(s: YouTubeSettings) {
    const p: string[] = [];
    if (!s.title?.trim()) p.push("YouTube: укажите название");
    if ((s.title ?? "").length > 100) p.push("YouTube: название длиннее 100 символов");
    if (/[<>]/.test(s.title ?? "") || /[<>]/.test(s.description ?? "")) p.push("YouTube: символы < и > запрещены в названии и описании");
    if ([...(s.description ?? "")].length > 5000) p.push("YouTube: описание длиннее 5000 символов");
    const tagChars = (s.tags ?? []).reduce((n, t) => n + t.length + (t.includes(" ") ? 2 : 0), 0) + Math.max(0, (s.tags ?? []).length - 1);
    if (tagChars > 500) p.push("YouTube: теги в сумме длиннее 500 символов");
    if (!["public", "unlisted", "private"].includes(s.privacy)) p.push("YouTube: выберите видимость");
    return p;
  },

  async step(ctx: StepContext): Promise<StepResult> {
    const s = ctx.settings as YouTubeSettings;
    const state = { ...ctx.state };
    const auth = { Authorization: `Bearer ${ctx.accessToken}` };

    if (!state.videoId) {
      if (!state.uploadUrl) {
        const metadata = {
          snippet: { title: s.title, description: s.description, tags: s.tags, categoryId: s.categoryId || "22" },
          status: {
            privacyStatus: s.privacy,
            selfDeclaredMadeForKids: !!s.madeForKids,
            containsSyntheticMedia: !!s.containsSyntheticMedia,
          },
          paidProductPlacementDetails: { hasPaidProductPlacement: !!s.paidPromotion },
        };
        const { headers } = await requestJson(ctx.fetch,
          `${UPLOAD_API}/videos?uploadType=resumable&part=snippet,status,paidProductPlacementDetails&notifySubscribers=true`, {
            method: "POST",
            headers: {
              ...auth, "Content-Type": "application/json; charset=UTF-8",
              "X-Upload-Content-Length": String(ctx.video.size), "X-Upload-Content-Type": ctx.video.mime || "video/*",
            },
            body: JSON.stringify(metadata),
          }, "YouTube");
        const location = headers.get("location");
        if (!location) throw new PlatformError("YouTube не вернул адрес загрузки", "no_upload_url", true);
        state.uploadUrl = location;
        state.offset = 0;
        ctx.saveState(state);
        ctx.log("Создана сессия загрузки YouTube");
      } else {
        // Resume after restart: ask YouTube how many bytes it already has.
        const r = await requestJson(ctx.fetch, state.uploadUrl, {
          method: "PUT", redirect: "manual", headers: { ...auth, "Content-Range": `bytes */${ctx.video.size}`, "Content-Length": "0" },
        }, "YouTube").catch((e: PlatformError) => {
          if (e.code === "http_404" || e.code === "http_410") {
            delete state.uploadUrl; ctx.saveState(state);
            throw new PlatformError("Сессия загрузки YouTube истекла, начнём заново", "upload_session_expired", true);
          }
          throw e;
        });
        if (r.status === 200 || r.status === 201) {
          state.videoId = r.body.id;
        } else {
          const range = r.headers.get("range");
          state.offset = range ? Number(range.split("-")[1]) + 1 : 0;
          ctx.log(`Продолжаем загрузку с ${state.offset} байт`);
        }
        ctx.saveState(state);
      }

      while (!state.videoId) {
        const start = state.offset as number;
        const len = Math.min(YT_CHUNK, ctx.video.size - start);
        const chunk = readChunk(ctx.video.path, start, len);
        const r = await requestJson(ctx.fetch, state.uploadUrl, {
          method: "PUT", redirect: "manual",
          headers: { ...auth, "Content-Length": String(len), "Content-Range": `bytes ${start}-${start + len - 1}/${ctx.video.size}` },
          body: new Uint8Array(chunk),
        }, "YouTube");
        if (r.status === 200 || r.status === 201) {
          state.videoId = r.body.id;
          ctx.log("Видео загружено на YouTube", { videoId: r.body.id });
        } else {
          const range = r.headers.get("range");
          state.offset = range ? Number(range.split("-")[1]) + 1 : start + len;
        }
        ctx.progress(Math.min(1, (state.offset ?? ctx.video.size) / ctx.video.size));
        ctx.saveState(state);
      }
    }

    if (s.coverVideoPath && !state.thumbnailDone) {
      try {
        await requestJson(ctx.fetch, `${UPLOAD_API}/thumbnails/set?videoId=${state.videoId}&uploadType=media`, {
          method: "POST",
          headers: { ...auth, "Content-Type": s.coverVideoPath.endsWith(".png") ? "image/png" : "image/jpeg" },
          body: new Uint8Array(fs.readFileSync(s.coverVideoPath)),
        }, "YouTube");
        ctx.log("Обложка установлена");
      } catch (e: any) {
        ctx.log(`Обложку установить не удалось: ${e.message} (для обложек канал должен быть подтверждён)`);
      }
      state.thumbnailDone = true;
      ctx.saveState(state);
    }

    const { body } = await requestJson(ctx.fetch, `${API}/videos?part=status,processingDetails&id=${state.videoId}`, { headers: auth }, "YouTube");
    const v = body.items?.[0];
    if (!v) return { kind: "continue", status: "processing", delayMs: 30_000, state };
    const st = v.status ?? {};
    if (st.uploadStatus === "rejected" || st.uploadStatus === "failed" || st.uploadStatus === "deleted") {
      throw new PlatformError(`YouTube отклонил видео: ${st.rejectionReason ?? st.failureReason ?? st.uploadStatus}`, `yt_${st.uploadStatus}`, false, v);
    }
    const url = `https://www.youtube.com/watch?v=${state.videoId}`;
    if (st.uploadStatus === "processed") {
      const privacyNote = st.privacyStatus === "public" ? "" : ` (видимость: ${st.privacyStatus === "private" ? "приватное" : "по ссылке"})`;
      return { kind: "done", status: "published", externalId: state.videoId, url, message: `Опубликовано на YouTube${privacyNote}`, state };
    }
    ctx.log(`YouTube обрабатывает видео (${st.uploadStatus})`);
    return { kind: "continue", status: "processing", delayMs: 30_000, state };
  },
};
