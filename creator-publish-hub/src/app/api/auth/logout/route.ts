import { cookies } from "next/headers";
import { json } from "@/lib/api";
import { SESSION_COOKIE } from "@/lib/session";

export async function POST() {
  (await cookies()).delete(SESSION_COOKIE);
  return json({ ok: true });
}
