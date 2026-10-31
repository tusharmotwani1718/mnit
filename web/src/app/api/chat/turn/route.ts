import { coreFetch } from "@/lib/server/core";
import { forbidden, getUserToken, sameOrigin } from "@/lib/server/session";

const LANGS = new Set(["hi", "mr", "en"]);
const SESSION_ID = /^web-[0-9a-f-]{36}$/;

/** One chat turn with the same agent as the phone line (channel "web"). Logged-in users chat with their saved profile. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return forbidden();
  const body = (await request.json().catch(() => ({}))) as { sessionId?: string; text?: string; lang?: string };
  if (!body.sessionId || !SESSION_ID.test(body.sessionId) || typeof body.text !== "string" || body.text.length > 1000) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const lang = body.lang && LANGS.has(body.lang) ? body.lang : undefined;
  const userToken = await getUserToken();
  try {
    const res = await coreFetch("/turn", { method: "POST", body: { sessionId: body.sessionId, text: body.text, lang, channel: "web" }, userToken });
    const data = (await res.json().catch(() => ({}))) as { done?: boolean };
    // The conversation is over: end the session so core sends the SMS checklist the user agreed to.
    if (res.ok && data.done) void coreFetch(`/sessions/${body.sessionId}/end`, { method: "POST", body: {}, userToken }).catch(() => {});
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "core_unreachable" }, { status: 502 });
  }
}
