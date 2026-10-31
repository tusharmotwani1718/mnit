import "server-only";

// Server-side only: the live-view token never reaches the browser bundle.
const CORE_URL = (process.env.CORE_URL ?? "http://localhost:8080").replace(/\/$/, "");
const LIVE_VIEW_TOKEN = process.env.LIVE_VIEW_TOKEN ?? "";

export function coreLiveUrl(path: string): string {
  const url = new URL(`${CORE_URL}/live${path}`);
  if (LIVE_VIEW_TOKEN) url.searchParams.set("token", LIVE_VIEW_TOKEN);
  return url.toString();
}
