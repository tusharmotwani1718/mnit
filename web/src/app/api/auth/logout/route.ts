import { clearUserToken, forbidden, sameOrigin } from "@/lib/server/session";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return forbidden();
  await clearUserToken();
  return Response.json({ loggedOut: true });
}
