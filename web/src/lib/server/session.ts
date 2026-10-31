import "server-only";
import { cookies } from "next/headers";

/** httpOnly cookie holding the login token core issued after OTP verification. */
const COOKIE = "yd_session";
const MAX_AGE_SEC = 30 * 24 * 60 * 60; // matches core's token lifetime

export async function getUserToken(): Promise<string | null> {
  return (await cookies()).get(COOKIE)?.value ?? null;
}

export async function setUserToken(token: string) {
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SEC,
  });
}

export async function clearUserToken() {
  (await cookies()).delete(COOKIE);
}

/**
 * State-changing requests must come from our own pages: the Origin header (sent by browsers on POST/PUT/DELETE)
 * has to match the Host. Together with SameSite=Lax cookies this blocks cross-site request forgery.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export const forbidden = () => Response.json({ error: "bad_origin" }, { status: 403 });

export function clientIp(request: Request): string | null {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
}
