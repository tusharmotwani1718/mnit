import { connection } from "next/server";
import { coreLiveUrl } from "@/lib/server/core";

/** Proxies core's server-sent events so the browser never sees the live-view token. */
export async function GET(request: Request) {
  await connection();
  let upstream: Response;
  try {
    upstream = await fetch(coreLiveUrl("/events"), { signal: request.signal, cache: "no-store" });
  } catch {
    return Response.json({ error: "core_unreachable" }, { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return Response.json({ error: "core_error", status: upstream.status }, { status: 502 });
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
