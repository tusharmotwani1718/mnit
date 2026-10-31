import { coreFetch } from "@/lib/server/core";
import { forbidden, sameOrigin, setUserToken } from "@/lib/server/session";

/** Checks the code; on success the login token goes into an httpOnly cookie (never to page JavaScript). */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return forbidden();
  const body = (await request.json().catch(() => ({}))) as { phone?: string; code?: string; lang?: string };
  if (typeof body.phone !== "string" || typeof body.code !== "string") return Response.json({ error: "invalid_code" }, { status: 400 });
  try {
    const res = await coreFetch("/auth/otp/verify", { method: "POST", body: { phone: body.phone, code: body.code, lang: body.lang } });
    const data = (await res.json().catch(() => ({}))) as { token?: string; profile?: unknown; error?: string };
    if (!res.ok || !data.token) return Response.json({ error: data.error ?? "invalid_code" }, { status: res.ok ? 500 : res.status });
    await setUserToken(data.token);
    return Response.json({ profile: data.profile });
  } catch {
    return Response.json({ error: "core_unreachable" }, { status: 502 });
  }
}
