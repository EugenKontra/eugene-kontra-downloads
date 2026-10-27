import { env, publicBaseUrl } from "../config";
import { signMediaPath, hmac } from "../crypto";
import { form, requestJson } from "./http";
import { PlatformError, type InstagramSettings, type PlatformAdapter, type StepContext, type StepResult } from "./types";

const graph = () => `https://graph.instagram.com/${env("INSTAGRAM_GRAPH_VERSION", "v23.0")}`;

export function buildCaption(caption: string, hashtags: string[]): string {
  const tags = (hashtags ?? []).map((t) => t.trim()).filter(Boolean).map((t) => (t.startsWith("#") ? t : `#${t}`));
  return [caption?.trim(), tags.join(" ")].filter(Boolean).join("\n\n");
}

export function signCoverPath(targetId: string, ttlSec = 6 * 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  return `/api/covers/${targetId}?exp=${exp}&sig=${hmac(`cover.${targetId}.${exp}`)}`;
}

export const instagram: PlatformAdapter = {
  platform: "instagram",
  capabilities: {
    automatic: "Полностью автоматическая публикация Reels (только профессиональный аккаунт: Business или Creator).",
    limits: [
      "До 100 публикаций через API за 24 часа на аккаунт.",
      "Reels через API: MP4/MOV, H.264/HEVC + AAC, 3 с – 15 мин, до 300 МБ.",
      "Instagram сам скачивает видео по ссылке — панель должна быть доступна из интернета по HTTPS.",
      "Метку «Оплачено партнёром» API не ставит — её нужно добавить в приложении.",
      "Отложенная публикация выполняется планировщиком этой панели.",
    ],
  },
  isConfigured: () => !!env("INSTAGRAM_APP_ID") && !!env("INSTAGRAM_APP_SECRET"),

  authorizeUrl(state, redirectUri) {
    const p = new URLSearchParams({
      client_id: env("INSTAGRAM_APP_ID"), redirect_uri: redirectUri, response_type: "code", state,
      scope: "instagram_business_basic,instagram_business_content_publish",
    });
    return `https://www.instagram.com/oauth/authorize?${p}`;
  },

  async exchangeCode(code, redirectUri) {
    const short = await requestJson(fetch, "https://api.instagram.com/oauth/access_token", {
      method: "POST",
      body: form({ client_id: env("INSTAGRAM_APP_ID"), client_secret: env("INSTAGRAM_APP_SECRET"), grant_type: "authorization_code", redirect_uri: redirectUri, code: code.replace(/#_$/, "") }),
    }, "Instagram OAuth");
    const data = short.body.data?.[0] ?? short.body;
    const perms = String(data.permissions ?? "");
    if (perms && !perms.includes("instagram_business_content_publish")) {
      throw new PlatformError("Не выдано разрешение на публикацию (instagram_business_content_publish)", "missing_scope", false);
    }
    const long = await requestJson(fetch,
      `https://graph.instagram.com/access_token?${new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: env("INSTAGRAM_APP_SECRET"), access_token: data.access_token })}`,
      {}, "Instagram OAuth");
    return { accessToken: long.body.access_token, refreshToken: null, expiresAt: Date.now() + long.body.expires_in * 1000, scopes: perms };
  },

  async fetchProfile(tokens) {
    const { body } = await requestJson(fetch, `${graph()}/me?fields=user_id,username,account_type&access_token=${encodeURIComponent(tokens.accessToken)}`, {}, "Instagram");
    if (body.account_type && !["BUSINESS", "MEDIA_CREATOR", "CREATOR"].includes(body.account_type)) {
      throw new PlatformError("Аккаунт Instagram должен быть профессиональным (Business или Creator)", "not_professional", false);
    }
    return { externalId: String(body.user_id ?? body.id), displayName: `@${body.username}` };
  },

  /** Long-lived tokens (60 days) are refreshed with the token itself. */
  async refresh(_refresh, accessToken) {
    const { body } = await requestJson(fetch,
      `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(accessToken)}`, {}, "Instagram OAuth")
      .catch((e: PlatformError) => { if (e.code === "190" || e.code === "OAuthException") e.authError = true; throw e; });
    return { accessToken: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  },

  validate(s: InstagramSettings) {
    const p: string[] = [];
    const caption = buildCaption(s.caption, s.hashtags);
    if (caption.length > 2200) p.push("Instagram: подпись с хештегами длиннее 2200 символов");
    if ((caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length > 30) p.push("Instagram: больше 30 хештегов");
    if ((caption.match(/@[\w.]+/g) ?? []).length > 20) p.push("Instagram: больше 20 упоминаний");
    return p;
  },

  async step(ctx: StepContext): Promise<StepResult> {
    const s = ctx.settings as InstagramSettings;
    const state = { ...ctx.state };
    const tok = `access_token=${encodeURIComponent(ctx.accessToken)}`;
    const igId = ctx.account.externalId;

    if (!state.containerId) {
      const params: Record<string, string> = {
        media_type: "REELS",
        video_url: publicBaseUrl() + signMediaPath(ctx.video.id),
        caption: buildCaption(s.caption, s.hashtags),
        share_to_feed: String(s.shareToFeed !== false),
      };
      if (s.coverPath) params.cover_url = publicBaseUrl() + signCoverPath(ctx.targetId);
      else if (s.coverOffsetMs != null) params.thumb_offset = String(Math.max(0, Math.round(s.coverOffsetMs)));
      const { body } = await requestJson(ctx.fetch, `${graph()}/${igId}/media?${tok}`, { method: "POST", body: form(params) }, "Instagram");
      state.containerId = body.id;
      ctx.saveState(state);
      ctx.log("Создан контейнер Reels, Instagram скачивает видео", { containerId: body.id });
      return { kind: "continue", status: "processing", delayMs: 15_000, state };
    }

    if (!state.mediaId) {
      const { body } = await requestJson(ctx.fetch, `${graph()}/${state.containerId}?fields=status_code,status&${tok}`, {}, "Instagram");
      const code = body.status_code;
      if (code === "ERROR" || code === "EXPIRED") {
        delete state.containerId; ctx.saveState(state);
        throw new PlatformError(`Instagram не смог обработать видео: ${body.status ?? code}`, `ig_${code}`, false, body);
      }
      if (code === "PUBLISHED") {
        return { kind: "done", status: "action_required", message: "Reels опубликован, но ссылку получить не удалось — проверьте аккаунт", state };
      }
      if (code !== "FINISHED") {
        ctx.log(`Instagram обрабатывает видео (${code ?? "IN_PROGRESS"})`);
        return { kind: "continue", status: "processing", delayMs: 20_000, state };
      }
      state.publishing = true;
      ctx.saveState(state);
      const pub = await requestJson(ctx.fetch, `${graph()}/${igId}/media_publish?${tok}`, { method: "POST", body: form({ creation_id: state.containerId }) }, "Instagram");
      state.mediaId = pub.body.id;
      ctx.saveState(state);
    }

    const { body } = await requestJson(ctx.fetch, `${graph()}/${state.mediaId}?fields=permalink,media_product_type&${tok}`, {}, "Instagram");
    return { kind: "done", status: "published", externalId: state.mediaId, url: body.permalink ?? null, message: "Reels опубликован", state };
  },
};
