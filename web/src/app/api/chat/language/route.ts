import { coreFetch, relay } from "@/lib/server/core";
import { forbidden, getUserToken, sameOrigin } from "@/lib/server/session";

const LANGS = new Set(["hi", "mr", "en"]);
const SESSION_ID = /^web-[0-9a-f-]{36}$/;

/** The user switched the site language mid-chat: the agent continues (and re-asks its question) in that language. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return forbidden();
  const body = (await request.json().catch(() => ({}))) as { sessionId?: string; lang?: string };
  if (!body.sessionId || !SESSION_ID.test(body.sessionId) || !body.lang || !LANGS.has(body.lang)) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const userToken = await getUserToken();
  return relay(() => coreFetch(`/sessions/${body.sessionId}/language`, { method: "POST", body: { lang: body.lang }, userToken }));
}
