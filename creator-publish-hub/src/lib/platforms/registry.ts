import type { Platform } from "./specs";
import type { PlatformAdapter } from "./types";
import { youtube } from "./youtube";
import { instagram } from "./instagram";
import { tiktok } from "./tiktok";

const adapters: Record<Platform, PlatformAdapter> = { youtube, instagram, tiktok };

export function adapter(platform: Platform): PlatformAdapter {
  const a = adapters[platform];
  if (!a) throw new Error(`Неизвестная платформа ${platform}`);
  return a;
}
