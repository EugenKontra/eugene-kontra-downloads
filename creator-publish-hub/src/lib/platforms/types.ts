import type { Platform } from "./specs";

export type TargetStatus =
  | "draft" | "scheduled" | "queued" | "uploading" | "processing"
  | "published" | "action_required" | "failed" | "cancelled";

export const STATUS_LABELS: Record<TargetStatus, string> = {
  draft: "Черновик",
  scheduled: "Запланировано",
  queued: "В очереди",
  uploading: "Загружается",
  processing: "Обрабатывается платформой",
  published: "Опубликовано",
  action_required: "Требуется действие",
  failed: "Ошибка",
  cancelled: "Отменено",
};

export type YouTubeSettings = {
  title: string;
  description: string;
  tags: string[];
  privacy: "public" | "unlisted" | "private";
  madeForKids: boolean;
  containsSyntheticMedia: boolean;
  paidPromotion: boolean;
  categoryId: string;
  coverVideoPath?: string | null;
};
export type InstagramSettings = {
  caption: string;
  hashtags: string[];
  shareToFeed: boolean;
  coverOffsetMs: number | null;
  coverPath?: string | null;
  paidPartnership: boolean;
};
export type TikTokSettings = {
  caption: string;
  hashtags: string[];
  privacy: "" | "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY";
  disableComment: boolean;
  disableDuet: boolean;
  disableStitch: boolean;
  coverOffsetMs: number | null;
  brandContentToggle: boolean;
  brandOrganicToggle: boolean;
  isAigc: boolean;
  musicConsent: boolean;
  mode: "direct" | "inbox";
};
export type TargetSettings = YouTubeSettings | InstagramSettings | TikTokSettings;

export function defaultSettings(platform: Platform): TargetSettings {
  switch (platform) {
    case "youtube":
      return { title: "", description: "", tags: [], privacy: "private", madeForKids: false, containsSyntheticMedia: false, paidPromotion: false, categoryId: "22" };
    case "instagram":
      return { caption: "", hashtags: [], shareToFeed: true, coverOffsetMs: null, paidPartnership: false };
    case "tiktok":
      return { caption: "", hashtags: [], privacy: "", disableComment: false, disableDuet: false, disableStitch: false, coverOffsetMs: null, brandContentToggle: false, brandOrganicToggle: false, isAigc: false, musicConsent: false, mode: "direct" };
  }
}

export type AccountRow = {
  id: string; platform: Platform; label: string; external_id: string | null; display_name: string | null;
  access_token_enc: string | null; refresh_token_enc: string | null; expires_at: number | null;
  refresh_expires_at: number | null; scopes: string | null; status: string; status_message: string | null;
  options_json: string; created_at: number; updated_at: number;
};

export type TokenSet = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: number | null;
  refreshExpiresAt?: number | null;
  scopes?: string | null;
};

export type StepContext = {
  targetId: string;
  account: { id: string; externalId: string | null; displayName: string | null; options: Record<string, unknown> };
  accessToken: string;
  settings: any;
  scheduledAt: number | null;
  video: { id: string; path: string; size: number; mime: string | null; filename: string; durationSec: number };
  state: Record<string, any>;
  /** Persist progress immediately (survives crash). */
  saveState: (state: Record<string, any>) => void;
  progress: (fraction: number) => void;
  log: (message: string, data?: unknown) => void;
  fetch: typeof fetch;
};

/** Result of one worker step. "continue" means: run again after `delayMs`. */
export type StepResult =
  | { kind: "continue"; status: "uploading" | "processing"; delayMs: number; state: Record<string, any> }
  | { kind: "done"; status: "published" | "action_required"; externalId?: string | null; url?: string | null; message?: string; state: Record<string, any> };

export class PlatformError extends Error {
  constructor(
    message: string,
    public code: string,
    public retryable: boolean,
    public details?: unknown,
    /** Token rejected → account requires reconnect. */
    public authError = false,
  ) {
    super(message);
  }
}

export interface PlatformAdapter {
  platform: Platform;
  isConfigured(): boolean;
  authorizeUrl(state: string, redirectUri: string, verifier: string): string;
  exchangeCode(code: string, redirectUri: string, verifier: string): Promise<TokenSet>;
  fetchProfile(tokens: TokenSet): Promise<{ externalId: string; displayName: string }>;
  refresh(refreshToken: string | null, accessToken: string): Promise<TokenSet>;
  /** Validates settings; returns list of human-readable problems. */
  validate(settings: any): string[];
  step(ctx: StepContext): Promise<StepResult>;
  capabilities: { automatic: string; limits: string[] };
}
