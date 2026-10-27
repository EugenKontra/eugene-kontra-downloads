import { cookies } from "next/headers";
import { z } from "zod";
import { error, handle, json } from "@/lib/api";
import { verifyPassword } from "@/lib/crypto";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { createSession, SESSION_COOKIE, SESSION_TTL_SEC } from "@/lib/session";

export const POST = handle(async (req: Request) => {
  if (!rateLimit(`login:${clientIp(req.headers)}`, 10, 15 * 60_000)) return error("Слишком много попыток входа. Подождите 15 минут.", 429);
  const { password } = z.object({ password: z.string().min(1).max(200) }).parse(await req.json());
  const hash = process.env.ADMIN_PASSWORD_HASH ?? "";
  if (!hash) return error("На сервере не задан ADMIN_PASSWORD_HASH", 500);
  if (!verifyPassword(password, hash)) return error("Неверный пароль", 401);
  (await cookies()).set(SESSION_COOKIE, await createSession(), {
    httpOnly: true, sameSite: "lax", secure: (process.env.PUBLIC_BASE_URL ?? "").startsWith("https://"), path: "/", maxAge: SESSION_TTL_SEC,
  });
  return json({ ok: true });
});
