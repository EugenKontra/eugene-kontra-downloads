import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "cph_session";
export const SESSION_TTL_SEC = 30 * 86400;

function secret(): Uint8Array {
  const hex = process.env.SESSION_SECRET ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("SESSION_SECRET не задан (64 hex-символа)");
  return new Uint8Array(hex.match(/../g)!.map((b) => parseInt(b, 16)));
}

export async function createSession(): Promise<string> {
  return new SignJWT({ sub: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SEC}s`)
    .sign(secret());
}

export async function verifySession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    return payload.sub === "admin";
  } catch {
    return false;
  }
}
