import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "./lib/session";

const PUBLIC_PATHS = [/^\/login$/, /^\/api\/auth\/login$/, /^\/api\/health$/, /^\/api\/media\/[\w-]+$/, /^\/api\/covers\/[\w-]+$/];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const method = req.method.toUpperCase();

  // CSRF: state-changing requests must come from our own origin.
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const origin = req.headers.get("origin");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    let ok = false;
    try { ok = !!origin && !!host && new URL(origin).host === host; } catch { ok = false; }
    if (!ok) return NextResponse.json({ error: "CSRF: запрос с чужого источника отклонён" }, { status: 403 });
  }

  if (PUBLIC_PATHS.some((r) => r.test(pathname))) return NextResponse.next();

  const authed = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (authed) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
