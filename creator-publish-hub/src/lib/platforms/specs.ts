import type { VideoMeta } from "../media";

export type Platform = "youtube" | "instagram" | "tiktok";
export const PLATFORMS: Platform[] = ["youtube", "instagram", "tiktok"];

export const PLATFORM_NAMES: Record<Platform, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
};

/** Requirements from official docs (checked 2026-10). */
export const SPECS = {
  youtube: {
    maxBytes: 256 * 1024 **3,
    shortsMaxSec: 180,
    containers: ["mov", "mp4", "m4a", "3gp", "3g2", "mj2", "webm", "matroska", "avi"],
    titleMax: 100,
    descriptionMax: 5000,
    tagsCharsMax: 500,
  },
  instagram: {
    maxBytes: 300 * 1024 ** 2,
    minSec: 3,
    maxSec: 15 * 60,
    containers: ["mov", "mp4"],
    videoCodecs: ["h264", "hevc"],
    audioCodecs: ["aac"],
    captionMax: 2200,
    hashtagsMax: 30,
    maxWidth: 1920,
    maxFps: 60,
  },
  tiktok: {
    maxBytes: 4 * 1024 ** 3,
    minSec: 3,
    maxSec: 10 * 60,
    containers: ["mov", "mp4", "webm"],
    videoCodecs: ["h264", "hevc", "vp8", "vp9"],
    captionMax: 2200,
    minSide: 360,
    maxSide: 4096,
    minFps: 23,
    maxFps: 60,
  },
} as const;

export type Issue = { level: "error" | "warning"; message: string };

function containerOk(container: string, list: readonly string[]) {
  return container.split(",").some((c) => list.includes(c.trim()));
}

/** Checks video compatibility for the platform. Errors block publishing, warnings don't. */
export function checkVideo(platform: Platform, meta: VideoMeta, size: number): Issue[] {
  const issues: Issue[] = [];
  const err = (message: string) => issues.push({ level: "error", message });
  const warn = (message: string) => issues.push({ level: "warning", message });
  const mb = (b: number) => `${Math.round(b / 1024 ** 2)} МБ`;
  const vertical = meta.height > meta.width;
  const ratio = meta.width / meta.height;
  const ratio916 = Math.abs(ratio - 9 / 16) < 0.02;

  if (platform === "youtube") {
    const s = SPECS.youtube;
    if (size > s.maxBytes) err(`Файл больше 256 ГБ`);
    if (!containerOk(meta.container, s.containers)) err(`Формат контейнера «${meta.container}» YouTube не принимает`);
    if (meta.durationSec > s.shortsMaxSec || !(vertical || meta.width === meta.height)) {
      warn(`Видео будет обычным роликом, а не Shorts (Shorts: вертикальное/квадратное, до 3 минут)`);
    }
  }
  if (platform === "instagram") {
    const s = SPECS.instagram;
    if (size > s.maxBytes) err(`Instagram API принимает Reels до 300 МБ, файл ${mb(size)}`);
    if (!containerOk(meta.container, s.containers)) err(`Instagram принимает только MP4/MOV`);
    if (!s.videoCodecs.includes(meta.videoCodec as any)) err(`Видеокодек ${meta.videoCodec} не поддерживается (нужен H.264 или HEVC)`);
    if (meta.audioCodec && !s.audioCodecs.includes(meta.audioCodec as any)) err(`Аудиокодек ${meta.audioCodec} не поддерживается (нужен AAC)`);
    if (meta.durationSec < s.minSec) err(`Reels должен быть не короче 3 секунд`);
    if (meta.durationSec > s.maxSec) err(`Reels через API — не длиннее 15 минут`);
    if (meta.width > s.maxWidth) err(`Ширина ${meta.width}px больше допустимых 1920px`);
    if (meta.fps > s.maxFps) err(`Частота ${meta.fps.toFixed(0)} fps больше 60`);
    if (!ratio916) warn(`Рекомендуемое соотношение для Reels — 9:16 (сейчас ${meta.width}×${meta.height})`);
  }
  if (platform === "tiktok") {
    const s = SPECS.tiktok;
    if (size > s.maxBytes) err(`TikTok API принимает файлы до 4 ГБ, файл ${mb(size)}`);
    if (!containerOk(meta.container, s.containers)) err(`TikTok принимает MP4, MOV или WebM`);
    if (!s.videoCodecs.includes(meta.videoCodec as any)) err(`Видеокодек ${meta.videoCodec} не поддерживается TikTok`);
    if (meta.durationSec < s.minSec) err(`Видео короче 3 секунд`);
    if (meta.durationSec > s.maxSec) err(`Видео длиннее 10 минут (лимит API; фактический лимит аккаунта проверяется при публикации)`);
    if (Math.min(meta.width, meta.height) < s.minSide || Math.max(meta.width, meta.height) > s.maxSide) err(`Разрешение должно быть от 360 до 4096 px по сторонам`);
    if (meta.fps && (meta.fps < s.minFps || meta.fps > s.maxFps)) err(`Частота кадров должна быть 23–60 fps`);
    if (!vertical) warn(`Для TikTok рекомендуется вертикальное видео 9:16`);
  }
  return issues;
}
