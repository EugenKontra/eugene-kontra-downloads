import { NextResponse } from "next/server";
import { saveConnectedAccount } from "@/lib/accounts";
import { publicBaseUrl } from "@/lib/config";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/events";
import { adapter } from "@/lib/platforms/registry";
import { PLATFORMS, type Platform } from "@/lib/platforms/specs";

type Ctx = { params: Promise<{ platform: string }> };

function back(params: Record<string, string>) {
  return NextResponse.redirect(`${publicBaseUrl()}/accounts?${new URLSearchParams(params)}`);
}

export async function GET(req: Request, { params }: Ctx) {
  const { platform } = await params;
  if (!PLATFORMS.includes(platform as Platform)) return back({ error: "Неизвестная платформа" });
  const url = new URL(req.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  const row = db().prepare("SELECT * FROM oauth_states WHERE state = ? AND platform = ?").get(state, platform) as any;
  db().prepare("DELETE FROM oauth_states WHERE state = ?").run(state);
  if (!row || row.created_at < Date.now() - 15 * 60_000) return back({ error: "Сессия подключения устарела или подделана (state). Попробуйте ещё раз." });
  if (!code) return back({ error: `Подключение отменено: ${url.searchParams.get("error_description") ?? url.searchParams.get("error") ?? "нет кода"}` });
  try {
    const a = adapter(platform as Platform);
    const redirectUri = `${publicBaseUrl()}/api/oauth/${platform}/callback`;
    const tokens = await a.exchangeCode(code, redirectUri, row.verifier);
    const profile = await a.fetchProfile(tokens);
    const id = saveConnectedAccount(platform as Platform, row.label, tokens, profile, row.account_id);
    logEvent(null, "info", `Подключён аккаунт ${platform}: ${profile.displayName}`, { accountId: id });
    return back({ connected: profile.displayName });
  } catch (e: any) {
    logEvent(null, "error", `Ошибка подключения ${platform}: ${e.message}`, e.details);
    return back({ error: e.message ?? "Ошибка подключения" });
  }
}
