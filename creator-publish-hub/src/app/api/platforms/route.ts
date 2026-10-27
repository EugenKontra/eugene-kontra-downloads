import { handle, json } from "@/lib/api";
import { publicBaseUrl } from "@/lib/config";
import { adapter } from "@/lib/platforms/registry";
import { PLATFORMS, PLATFORM_NAMES } from "@/lib/platforms/specs";

export const dynamic = "force-dynamic";
export const GET = handle(async () => json(PLATFORMS.map((p) => ({
  platform: p, name: PLATFORM_NAMES[p], configured: adapter(p).isConfigured(),
  redirectUri: `${publicBaseUrl()}/api/oauth/${p}/callback`, ...adapter(p).capabilities,
}))));
