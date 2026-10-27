import crypto from "node:crypto";
import { env } from "./config";

function key(name: string): Buffer {
  const hex = env(name);
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`${name} должен содержать 64 hex-символа (openssl rand -hex 32)`);
  }
  return Buffer.from(hex, "hex");
}

export function newId(): string {
  return crypto.randomUUID();
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key("ENCRYPTION_KEY"), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decrypt(blob: string): string {
  const [v, iv, tag, ct] = blob.split(".");
  if (v !== "v1") throw new Error("Неизвестный формат шифрования");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key("ENCRYPTION_KEY"), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

export function hmac(data: string): string {
  return crypto.createHmac("sha256", key("SESSION_SECRET")).update(data).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Format: scrypt:<salt>:<hash> (no "$", which .env loaders would try to expand). */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt.toString("base64url")}:${hash.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, salt, hash] = stored.trim().split(":");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const calc = crypto.scryptSync(password, Buffer.from(salt, "base64url"), 64);
  const expected = Buffer.from(hash, "base64url");
  return calc.length === expected.length && crypto.timingSafeEqual(calc, expected);
}

/** Time-limited signed URL path for media files (used by Instagram to fetch the video). */
export function signMediaPath(videoId: string, ttlSec = 6 * 3600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  return `/api/media/${videoId}?exp=${exp}&sig=${hmac(`${videoId}.${exp}`)}`;
}

export function verifyMediaSig(videoId: string, exp: string, sig: string): boolean {
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now() / 1000) return false;
  return safeEqual(hmac(`${videoId}.${exp}`), sig);
}
