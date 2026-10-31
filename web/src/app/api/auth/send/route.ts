import { coreFetch, relay } from "@/lib/server/core";
import { clientIp, forbidden, sameOrigin } from "@/lib/server/session";

/** Sends a login code by SMS. Rate limits (per number and per IP) are enforced by core. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return forbidden();
  const body = (await request.json().catch(() => ({}))) as { phone?: string; lang?: string };
  if (typeof body.phone !== "string" || body.phone.length > 20) return Response.json({ error: "invalid_phone" }, { status: 400 });
  return relay(() => coreFetch("/auth/otp/send", { method: "POST", body: { phone: body.phone, lang: body.lang }, clientIp: clientIp(request) }));
}
