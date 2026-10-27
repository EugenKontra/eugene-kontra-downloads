import { env } from "../config";
import { buildCaption } from "./instagram";
import { form, readChunk, requestJson as rawRequest } from "./http";
import { PlatformError, type PlatformAdapter, type StepContext, type StepResult, type TikTokSettings } from "./types";

const API = "https://open.tiktokapis.com/v2";
const MIN_CHUNK = 5 * 1024 * 1024;
const CHUNK = 10 * 1024 * 1024;

/** TikTok Media Transfer rules: 5–64 MB chunks, last chunk may hold the remainder (≤128 MB), ≤1000 chunks. */
export function chunkPlan(size: number): { chunkSize: number; count: number } {
  if (size <= MIN_CHUNK) return { chunkSize: size, count: 1 };
  if (size <= CHUNK) return { chunkSize: size, count: 1 };
  return { chunkSize: CHUNK, count: Math.floor(size / CHUNK) };
}

/** Wraps HTTP errors with human-readable TikTok error texts. */
async function requestJson(...args: Parameters<typeof rawRequest>) {
  try {
    return await rawRequest(...args);
  } catch (e) {
    if (e instanceof PlatformError && !e.code.startsWith("http_") && e.code !== "network") {
      e.message = `TikTok: ${humanError(e.code)}`;
      if (e.code === "access_token_invalid") e.authError = true;
    }
    throw e;
  }
}

/** TikTok returns HTTP 200 with error.code != "ok" in some cases. */
function check(body: any, what: string) {
  const code = body?.error?.code;
  if (code && code !== "ok") {
    const retryable = /rate_limit|internal|timeout/.test(code);
    throw new PlatformError(`TikTok (${what}): ${humanError(code, body.error.message)}`, code, retryable, body, code === "access_token_invalid");
  }
  return body;
}

export function humanError(code: string, msg?: string): string {
  const map: Record<string, string> = {
    unaudited_client_can_only_post_to_private_accounts: "приложение TikTok не прошло аудит — публиковать можно только в приватный аккаунт (или пройдите аудит Direct Post)",
    spam_risk_too_many_posts: "достигнут дневной лимит публикаций TikTok",
    spam_risk_user_banned_from_posting: "аккаунту временно запрещено публиковать",
    privacy_level_option_mismatch: "выбранная видимость недоступна для этого аккаунта",
    reached_active_user_cap: "достигнут лимит активных пользователей неаудированного приложения",
    scope_not_authorized: "аккаунт не выдал нужное разрешение (video.publish / video.upload)",
    access_token_invalid: "токен недействителен — переподключите аккаунт",
    rate_limit_exceeded: "превышен лимит запросов, повторим позже",
  };
  return map[code] ?? `${code}${msg ? ` — ${msg}` : ""}`;
}

export const tiktok: PlatformAdapter = {
  platform: "tiktok",
  capabilities: {
    automatic: "Прямая публикация (Direct Post) — после аудита приложения TikTok; без аудита — только приватно (SELF_ONLY). Альтернатива: отправка в черновики/уведомления TikTok с завершением в приложении.",
    limits: [
      "Без аудита: все публикации приватные, не более 5 пользователей приложения за 24 ч.",
      "Около 6 запросов на публикацию в минуту на пользователя; дневной лимит постов задаёт TikTok.",
      "Файл до 4 ГБ; длительность — не больше разрешённой для аккаунта (проверяется при публикации).",
      "Отложенная публикация выполняется планировщиком этой панели.",
    ],
  },
  isConfigured: () => !!env("TIKTOK_CLIENT_KEY") && !!env("TIKTOK_CLIENT_SECRET"),

  authorizeUrl(state, redirectUri) {
    const p = new URLSearchParams({
      client_key: env("TIKTOK_CLIENT_KEY"), response_type: "code", redirect_uri: redirectUri, state,
      scope: "user.info.basic,video.publish,video.upload",
    });
    return `https://www.tiktok.com/v2/auth/authorize/?${p}`;
  },

  async exchangeCode(code, redirectUri) {
    const { body } = await requestJson(fetch, `${API}/oauth/token/`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form({ client_key: env("TIKTOK_CLIENT_KEY"), client_secret: env("TIKTOK_CLIENT_SECRET"), code, grant_type: "authorization_code", redirect_uri: redirectUri }),
    }, "TikTok OAuth");
    if (body.error && typeof body.error === "string") throw new PlatformError(`TikTok OAuth: ${body.error_description ?? body.error}`, body.error, false);
    return {
      accessToken: body.access_token, refreshToken: body.refresh_token, scopes: body.scope,
      expiresAt: Date.now() + body.expires_in * 1000, refreshExpiresAt: Date.now() + body.refresh_expires_in * 1000,
    };
  },

  async fetchProfile(tokens) {
    const { body } = await requestJson(fetch, `${API}/user/info/?fields=open_id,display_name,username`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    }, "TikTok");
    check(body, "профиль");
    const u = body.data.user;
    return { externalId: u.open_id, displayName: u.username ? `@${u.username}` : u.display_name };
  },

  async refresh(refreshToken) {
    if (!refreshToken) throw new PlatformError("Нет refresh token — подключите аккаунт заново", "no_refresh", false, undefined, true);
    const { body } = await requestJson(fetch, `${API}/oauth/token/`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form({ client_key: env("TIKTOK_CLIENT_KEY"), client_secret: env("TIKTOK_CLIENT_SECRET"), grant_type: "refresh_token", refresh_token: refreshToken }),
    }, "TikTok OAuth");
    if (body.error && typeof body.error === "string") throw new PlatformError(`TikTok OAuth: ${body.error_description ?? body.error}`, body.error, false, undefined, body.error === "invalid_grant");
    return {
      accessToken: body.access_token, refreshToken: body.refresh_token, scopes: body.scope,
      expiresAt: Date.now() + body.expires_in * 1000, refreshExpiresAt: Date.now() + body.refresh_expires_in * 1000,
    };
  },

  validate(s: TikTokSettings) {
    const p: string[] = [];
    if (buildCaption(s.caption, s.hashtags).length > 2200) p.push("TikTok: подпись длиннее 2200 символов");
    if (s.mode === "direct") {
      if (!s.privacy) p.push("TikTok: выберите, кто может смотреть видео (по правилам TikTok значение не выбирается по умолчанию)");
      if (!s.musicConsent) p.push("TikTok: подтвердите согласие с Music Usage Confirmation");
      if (s.brandContentToggle && s.privacy === "SELF_ONLY") p.push("TikTok: брендированный контент не может быть приватным");
    }
    return p;
  },

  async step(ctx: StepContext): Promise<StepResult> {
    const s = ctx.settings as TikTokSettings;
    const state = { ...ctx.state };
    const headers = { Authorization: `Bearer ${ctx.accessToken}`, "Content-Type": "application/json; charset=UTF-8" };

    if (!state.publishId) {
      const plan = chunkPlan(ctx.video.size);
      const source_info = { source: "FILE_UPLOAD", video_size: ctx.video.size, chunk_size: plan.chunkSize, total_chunk_count: plan.count };
      let url = `${API}/post/publish/inbox/video/init/`;
      let payload: any = { source_info };
      if (s.mode === "direct") {
        const info = check((await requestJson(ctx.fetch, `${API}/post/publish/creator_info/query/`, { method: "POST", headers, body: "{}" }, "TikTok")).body, "creator_info").data;
        if (!info.privacy_level_options?.includes(s.privacy)) {
          throw new PlatformError(`TikTok: видимость ${s.privacy} недоступна. Доступно: ${info.privacy_level_options?.join(", ")}`, "privacy_level_option_mismatch", false, info);
        }
        if (info.max_video_post_duration_sec && ctx.video.durationSec > info.max_video_post_duration_sec) {
          throw new PlatformError(`TikTok: видео длиннее разрешённых аккаунту ${info.max_video_post_duration_sec} с`, "duration_exceeded", false);
        }
        url = `${API}/post/publish/video/init/`;
        payload = {
          post_info: {
            title: buildCaption(s.caption, s.hashtags), privacy_level: s.privacy,
            disable_comment: !!(s.disableComment || info.comment_disabled),
            disable_duet: !!(s.disableDuet || info.duet_disabled),
            disable_stitch: !!(s.disableStitch || info.stitch_disabled),
            ...(s.coverOffsetMs != null ? { video_cover_timestamp_ms: Math.round(s.coverOffsetMs) } : {}),
            brand_content_toggle: !!s.brandContentToggle, brand_organic_toggle: !!s.brandOrganicToggle, is_aigc: !!s.isAigc,
          },
          source_info,
        };
        state.username = info.creator_username;
      }
      const init = check((await requestJson(ctx.fetch, url, { method: "POST", headers, body: JSON.stringify(payload) }, "TikTok")).body, "init").data;
      Object.assign(state, { publishId: init.publish_id, uploadUrl: init.upload_url, chunkSize: plan.chunkSize, chunkCount: plan.count, chunk: 0, uploadedAt: Date.now() });
      ctx.saveState(state);
      ctx.log(s.mode === "direct" ? "Инициализирована прямая публикация TikTok" : "Инициализирована отправка в черновики TikTok", { publishId: init.publish_id });
    }

    if (state.chunk < state.chunkCount) {
      if (Date.now() - state.uploadedAt > 55 * 60_000) {
        // upload_url is valid for 1 hour: restart from scratch.
        for (const k of ["publishId", "uploadUrl", "chunk", "chunkCount", "chunkSize", "uploadedAt"]) delete state[k];
        ctx.saveState(state);
        throw new PlatformError("Ссылка загрузки TikTok истекла, начнём заново", "upload_url_expired", true);
      }
      while (state.chunk < state.chunkCount) {
        const start = state.chunk * state.chunkSize;
        const end = state.chunk === state.chunkCount - 1 ? ctx.video.size - 1 : start + state.chunkSize - 1;
        const buf = readChunk(ctx.video.path, start, end - start + 1);
        await requestJson(ctx.fetch, state.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": ctx.video.mime || "video/mp4", "Content-Length": String(buf.length), "Content-Range": `bytes ${start}-${end}/${ctx.video.size}` },
          body: new Uint8Array(buf),
        }, "TikTok");
        state.chunk += 1;
        ctx.progress(state.chunk / state.chunkCount);
        ctx.saveState(state);
      }
      ctx.log("Видео передано в TikTok");
      return { kind: "continue", status: "processing", delayMs: 10_000, state };
    }

    const { body } = await requestJson(ctx.fetch, `${API}/post/publish/status/fetch/`, {
      method: "POST", headers, body: JSON.stringify({ publish_id: state.publishId }),
    }, "TikTok");
    const d = check(body, "статус").data;
    switch (d.status) {
      case "PUBLISH_COMPLETE": {
        const postId = d.publicaly_available_post_id?.[0] ?? null;
        const url = postId && state.username ? `https://www.tiktok.com/@${state.username}/video/${postId}` : null;
        const message = s.privacy === "SELF_ONLY" || !postId
          ? "Опубликовано в TikTok (приватно — видно только вам; ссылку TikTok не возвращает)"
          : "Опубликовано в TikTok";
        return { kind: "done", status: "published", externalId: postId ?? state.publishId, url, message, state };
      }
      case "SEND_TO_USER_INBOX":
        return { kind: "done", status: "action_required", externalId: state.publishId, message: "Видео в TikTok-уведомлениях: откройте приложение TikTok и завершите публикацию", state };
      case "FAILED":
        throw new PlatformError(`TikTok: публикация не удалась — ${humanError(d.fail_reason ?? "unknown")}`, d.fail_reason ?? "failed", false, d);
      default:
        ctx.log(`TikTok обрабатывает видео (${d.status})`);
        return { kind: "continue", status: "processing", delayMs: 15_000, state };
    }
  },
};
