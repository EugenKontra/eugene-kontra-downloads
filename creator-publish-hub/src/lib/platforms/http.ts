import fs from "node:fs";
import { PlatformError } from "./types";

const SECRET_KEYS = /token|secret|code_verifier|authorization|password|client_secret/i;

/** Removes secrets from API responses before they're stored/displayed. */
export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 6) return "…";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitize(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEYS.test(k) ? "[скрыто]" : sanitize(v, depth + 1);
    return out;
  }
  if (typeof value === "string") {
    return value.replace(/(access_token=)[^&\s"]+/gi, "$1[скрыто]").slice(0, 2000);
  }
  return value;
}

export async function requestJson(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  platform: string,
): Promise<{ status: number; headers: Headers; body: any }> {
  let res: Response;
  try {
    res = await fetchFn(url, init);
  } catch (e: any) {
    throw new PlatformError(`${platform}: сетевая ошибка (${e?.message ?? e})`, "network", true);
  }
  const text = await res.text();
  let body: any = text;
  try { body = text ? JSON.parse(text) : {}; } catch { /* keep text */ }
  if (res.status >= 200 && res.status < 400) return { status: res.status, headers: res.headers, body };
  const message = extractMessage(body) ?? `HTTP ${res.status}`;
  const code = extractCode(body) ?? `http_${res.status}`;
  const retryable = res.status === 429 || res.status >= 500 || /rate.?limit|quota.*per.*minute|backendError|internal/i.test(code);
  throw new PlatformError(`${platform}: ${message}`, code, retryable, sanitize(body), res.status === 401);
}

function extractMessage(body: any): string | undefined {
  if (!body || typeof body !== "object") return typeof body === "string" ? body.slice(0, 300) : undefined;
  return body.error?.message ?? body.error_description ?? body.error_message ?? body.message ??
    (typeof body.error === "string" ? body.error : undefined);
}

function extractCode(body: any): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const e = body.error;
  if (e && typeof e === "object") {
    return String(e.errors?.[0]?.reason ?? e.code ?? e.status ?? e.type ?? "") || undefined;
  }
  return typeof e === "string" ? e : undefined;
}

export function readChunk(path: string, start: number, length: number): Buffer {
  const fd = fs.openSync(path, "r");
  try {
    const buf = Buffer.allocUnsafe(length);
    let read = 0;
    while (read < length) {
      const n = fs.readSync(fd, buf, read, length - read, start + read);
      if (n === 0) break;
      read += n;
    }
    return buf.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
}

export function form(data: Record<string, string>): URLSearchParams {
  return new URLSearchParams(data);
}
