import { NextResponse } from "next/server";
import { error, handle } from "@/lib/api";
import { publicBaseUrl } from "@/lib/config";
import { randomToken } from "@/lib/crypto";
import { db } from "@/lib/db";
import { adapter } from "@/lib/platforms/registry";
import { PLATFORMS, type Platform } from "@/lib/platforms/specs";

type Ctx = { params: Promise<{ platform: string }> };

export const GET = handle(async (req: Request, { params }: Ctx) => {
  const { platform } = await params;
  if (!PLATFORMS.includes(platform as Platform)) return error("Неизвестная платформа", 404);
  const a = adapter(platform as Platform);
  if (!a.isConfigured()) return error("Ключи API этой платформы не настроены в .env на сервере", 400);
  const url = new URL(req.url);
  const label = (url.searchParams.get("label") ?? "").slice(0, 60);
  const accountId = url.searchParams.get("accountId");
  const state = randomToken(24);
  const verifier = randomToken(48);
  db().prepare("DELETE FROM oauth_states WHERE created_at < ?").run(Date.now() - 15 * 60_000);
  db().prepare("INSERT INTO oauth_states(state, platform, label, account_id, verifier, created_at) VALUES(?, ?, ?, ?, ?, ?)")
    .run(state, platform, label, accountId, verifier, Date.now());
  const redirectUri = `${publicBaseUrl()}/api/oauth/${platform}/callback`;
  return NextResponse.redirect(a.authorizeUrl(state, redirectUri, verifier));
});
