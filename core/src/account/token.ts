import { createHmac, timingSafeEqual } from "node:crypto";

/** Logged-in sessions last this long; the user logs in again with a new OTP after that. */
export const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const sign = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest("base64url");

/** `<payload>.<hmac>`: a stateless login token for a verified phone number. */
export function createToken(phone: string, secret: string, now = Date.now(), ttlMs = TOKEN_TTL_MS): string {
  const payload = b64url(JSON.stringify({ phone, exp: now + ttlMs }));
  return `${payload}.${sign(payload, secret)}`;
}

/** The phone number in a valid, unexpired token; otherwise null. */
export function verifyToken(token: string | undefined, secret: string, now = Date.now()): string | null {
  if (!token) return null;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { phone, exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { phone?: unknown; exp?: unknown };
    return typeof phone === "string" && typeof exp === "number" && exp > now ? phone : null;
  } catch {
    return null;
  }
}
