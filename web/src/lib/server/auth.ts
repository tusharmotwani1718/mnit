import "server-only";
import { coreFetch } from "./core";
import { forbidden, sameOrigin, setUserToken } from "./session";

/** Signup / login: forwards phone + password to core; on success the token goes into an httpOnly cookie. */
export async function credentialsRoute(request: Request, corePath: "/auth/signup" | "/auth/login"): Promise<Response> {
  if (!sameOrigin(request)) return forbidden();
  const body = (await request.json().catch(() => ({}))) as { phone?: unknown; password?: unknown; lang?: unknown };
  if (typeof body.phone !== "string" || typeof body.password !== "string" || body.phone.length > 20 || body.password.length > 200) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  try {
    const res = await coreFetch(corePath, { method: "POST", body: { phone: body.phone, password: body.password, lang: body.lang } });
    const data = (await res.json().catch(() => ({}))) as { token?: string; profile?: unknown; error?: string };
    if (!res.ok || !data.token) return Response.json({ error: data.error ?? "unknown" }, { status: res.ok ? 500 : res.status });
    await setUserToken(data.token);
    return Response.json({ profile: data.profile }, { status: res.status });
  } catch {
    return Response.json({ error: "core_unreachable" }, { status: 502 });
  }
}
