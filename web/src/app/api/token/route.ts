import { randomUUID } from "node:crypto";
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from "livekit-server-sdk";
import { forbidden, sameOrigin } from "@/lib/server/session";

const LANGS = new Set(["hi", "mr", "en"]);

/** Issues a LiveKit token for a browser call and asks for the Yojana agent by name (explicit dispatch). */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return forbidden(); // only our pages may start (paid) calls
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    return Response.json({ error: "livekit_not_configured" }, { status: 500 });
  }
  const body = (await request.json().catch(() => ({}))) as { lang?: string };
  const lang = body.lang && LANGS.has(body.lang) ? body.lang : "hi";

  const roomName = `web-${randomUUID().slice(0, 8)}`;
  const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: `browser-${randomUUID().slice(0, 8)}`,
    ttl: "15m",
    attributes: { "yojana.lang": lang }, // the worker starts the call in this language
  });
  token.addGrant({ room: roomName, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
  token.roomConfig = new RoomConfiguration({
    agents: [new RoomAgentDispatch({ agentName: process.env.AGENT_NAME ?? "yojana" })],
  });

  return Response.json({ serverUrl: LIVEKIT_URL, token: await token.toJwt(), roomName });
}
