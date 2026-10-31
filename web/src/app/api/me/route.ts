import { coreFetch, relay } from "@/lib/server/core";
import { clearUserToken, forbidden, getUserToken, sameOrigin } from "@/lib/server/session";

/** The logged-in user's profile (401 when not logged in). */
export async function GET() {
  const userToken = await getUserToken();
  if (!userToken) return Response.json({ error: "not_logged_in" }, { status: 401 });
  const res = await relay(() => coreFetch("/me", { userToken }));
  if (res.status === 401) await clearUserToken(); // expired or invalid token
  return res;
}

export async function PUT(request: Request) {
  if (!sameOrigin(request)) return forbidden();
  const userToken = await getUserToken();
  if (!userToken) return Response.json({ error: "not_logged_in" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ error: "invalid_request" }, { status: 400 });
  return relay(() => coreFetch("/me", { method: "PUT", body, userToken }));
}

/** Deletes the profile and logs out. */
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return forbidden();
  const userToken = await getUserToken();
  if (!userToken) return Response.json({ error: "not_logged_in" }, { status: 401 });
  const res = await relay(() => coreFetch("/me", { method: "DELETE", userToken }));
  if (res.ok) await clearUserToken();
  return res;
}
