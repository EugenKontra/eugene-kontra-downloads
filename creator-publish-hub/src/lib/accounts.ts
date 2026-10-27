import { db } from "./db";
import { decrypt, encrypt, newId } from "./crypto";
import { adapter } from "./platforms/registry";
import type { Platform } from "./platforms/specs";
import { PlatformError, type AccountRow, type TokenSet } from "./platforms/types";

export type PublicAccount = {
  id: string; platform: Platform; label: string; displayName: string | null; externalId: string | null;
  status: string; statusMessage: string | null; expiresAt: number | null; scopes: string | null;
  options: Record<string, unknown>; createdAt: number;
};

export function toPublic(a: AccountRow): PublicAccount {
  return {
    id: a.id, platform: a.platform, label: a.label, displayName: a.display_name, externalId: a.external_id,
    status: a.status, statusMessage: a.status_message, expiresAt: a.expires_at, scopes: a.scopes,
    options: JSON.parse(a.options_json || "{}"), createdAt: a.created_at,
  };
}

export function listAccounts(): AccountRow[] {
  return db().prepare("SELECT * FROM accounts ORDER BY platform, label").all() as AccountRow[];
}

export function getAccount(id: string): AccountRow | undefined {
  return db().prepare("SELECT * FROM accounts WHERE id = ?").get(id) as AccountRow | undefined;
}

/** Creates or updates an account after OAuth. Re-connecting the same channel updates tokens instead of duplicating. */
export function saveConnectedAccount(platform: Platform, label: string, tokens: TokenSet, profile: { externalId: string; displayName: string }, accountId?: string | null): string {
  const now = Date.now();
  const existing = (accountId ? getAccount(accountId) : undefined) ??
    (db().prepare("SELECT * FROM accounts WHERE platform = ? AND external_id = ?").get(platform, profile.externalId) as AccountRow | undefined);
  const id = existing?.id ?? newId();
  const refreshEnc = tokens.refreshToken ? encrypt(tokens.refreshToken) : existing?.refresh_token_enc ?? null;
  db().prepare(`
    INSERT INTO accounts(id, platform, label, external_id, display_name, access_token_enc, refresh_token_enc, expires_at, refresh_expires_at, scopes, status, status_message, created_at, updated_at)
    VALUES(@id, @platform, @label, @externalId, @displayName, @access, @refresh, @expiresAt, @refreshExpiresAt, @scopes, 'connected', NULL, @now, @now)
    ON CONFLICT(id) DO UPDATE SET label = excluded.label, external_id = excluded.external_id, display_name = excluded.display_name,
      access_token_enc = excluded.access_token_enc, refresh_token_enc = excluded.refresh_token_enc, expires_at = excluded.expires_at,
      refresh_expires_at = excluded.refresh_expires_at, scopes = excluded.scopes, status = 'connected', status_message = NULL, updated_at = excluded.updated_at
  `).run({
    id, platform, label: label || existing?.label || profile.displayName, externalId: profile.externalId, displayName: profile.displayName,
    access: encrypt(tokens.accessToken), refresh: refreshEnc, expiresAt: tokens.expiresAt ?? null,
    refreshExpiresAt: tokens.refreshExpiresAt ?? null, scopes: tokens.scopes ?? null, now,
  });
  return id;
}

export function setAccountStatus(id: string, status: "connected" | "disabled" | "reconnect_required", message: string | null = null) {
  db().prepare("UPDATE accounts SET status = ?, status_message = ?, updated_at = ? WHERE id = ?").run(status, message, Date.now(), id);
}

export function updateAccount(id: string, patch: { label?: string; options?: Record<string, unknown> }) {
  const a = getAccount(id);
  if (!a) return;
  db().prepare("UPDATE accounts SET label = ?, options_json = ?, updated_at = ? WHERE id = ?")
    .run(patch.label ?? a.label, JSON.stringify(patch.options ?? JSON.parse(a.options_json)), Date.now(), id);
}

export function deleteAccount(id: string) {
  db().prepare("DELETE FROM accounts WHERE id = ?").run(id);
}

/** Returns a valid access token, refreshing it when it expires within 5 minutes. */
export async function getAccessToken(account: AccountRow, refresher = adapter(account.platform).refresh): Promise<string> {
  if (!account.access_token_enc) throw new PlatformError("Аккаунт не подключён", "not_connected", false, undefined, true);
  const access = decrypt(account.access_token_enc);
  const needRefresh = account.expires_at != null && account.expires_at - Date.now() < 5 * 60_000;
  // Instagram long-lived tokens: refresh when older than ~7 days of remaining life left.
  const igRefresh = account.platform === "instagram" && account.expires_at != null && account.expires_at - Date.now() < 7 * 86400_000;
  if (!needRefresh && !igRefresh) return access;
  try {
    const t = await refresher(account.refresh_token_enc ? decrypt(account.refresh_token_enc) : null, access);
    db().prepare("UPDATE accounts SET access_token_enc = ?, refresh_token_enc = COALESCE(?, refresh_token_enc), expires_at = ?, refresh_expires_at = COALESCE(?, refresh_expires_at), updated_at = ? WHERE id = ?")
      .run(encrypt(t.accessToken), t.refreshToken ? encrypt(t.refreshToken) : null, t.expiresAt ?? null, t.refreshExpiresAt ?? null, Date.now(), account.id);
    return t.accessToken;
  } catch (e) {
    if (e instanceof PlatformError && e.authError) {
      setAccountStatus(account.id, "reconnect_required", "Доступ отозван или истёк — подключите аккаунт заново");
    }
    if (!needRefresh) return access; // IG token still valid, try anyway
    throw e;
  }
}
