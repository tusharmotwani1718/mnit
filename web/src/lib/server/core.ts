import "server-only";

// Server-side only: the core API key, live-view token and user tokens never reach the browser bundle.
const CORE_URL = (process.env.CORE_URL ?? "http://localhost:8080").replace(/\/$/, "");
const LIVE_VIEW_TOKEN = process.env.LIVE_VIEW_TOKEN ?? "";
const CORE_API_KEY = process.env.CORE_API_KEY ?? "";

export function coreLiveUrl(path: string): string {
  const url = new URL(`${CORE_URL}/live${path}`);
  if (LIVE_VIEW_TOKEN) url.searchParams.set("token", LIVE_VIEW_TOKEN);
  return url.toString();
}

/** Calls core's API with the server's key, and the user's login token when there is one. */
export async function coreFetch(
  path: string,
  { method = "GET", body, userToken, clientIp }: { method?: string; body?: unknown; userToken?: string | null; clientIp?: string | null } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (CORE_API_KEY) headers.authorization = `Bearer ${CORE_API_KEY}`;
  if (userToken) headers["x-user-token"] = userToken;
  if (clientIp) headers["x-client-ip"] = clientIp;
  return fetch(`${CORE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
}

/** Passes core's JSON response (and status) through; 502 if core is unreachable. */
export async function relay(call: () => Promise<Response>): Promise<Response> {
  try {
    const res = await call();
    const data = await res.json().catch(() => ({}));
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "core_unreachable" }, { status: 502 });
  }
}
