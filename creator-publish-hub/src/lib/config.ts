import path from "node:path";

export const TIMEZONE = "Europe/Berlin";

export function env(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export function dataDir(): string {
  return path.resolve(env("DATA_DIR", "./data"));
}

export function publicBaseUrl(): string {
  return env("PUBLIC_BASE_URL", "http://localhost:3000").replace(/\/$/, "");
}

export function maxUploadBytes(): number {
  return Math.round(Number(env("MAX_UPLOAD_GB", "10")) * 1024 ** 3);
}
