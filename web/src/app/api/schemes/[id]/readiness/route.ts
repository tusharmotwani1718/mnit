import { coreFetch, relay } from "@/lib/server/core";
import { forbidden, getUserToken, sameOrigin } from "@/lib/server/session";

/** Application readiness for one scheme. Logged-in users' answers come from (and are saved to) their profile. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return forbidden();
  const { id } = await ctx.params;
  if (!/^[a-z0-9-]{1,40}$/.test(id)) return Response.json({ error: "unknown_scheme" }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const userToken = await getUserToken();
  return relay(() => coreFetch(`/schemes/${id}/readiness`, { method: "POST", body, userToken }));
}
