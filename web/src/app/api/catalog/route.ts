import { connection } from "next/server";
import { coreFetch } from "@/lib/server/core";

const TTL_MS = 10 * 60 * 1000;
let cached: { at: number; data: unknown } | null = null;

/** Scheme and question texts in hi / mr / en (changes only when core's data changes, so it's cached briefly). */
export async function GET() {
  await connection();
  if (cached && Date.now() - cached.at < TTL_MS) return Response.json(cached.data);
  try {
    const res = await coreFetch("/catalog");
    if (!res.ok) return Response.json({ error: "core_error" }, { status: 502 });
    cached = { at: Date.now(), data: await res.json() };
    return Response.json(cached.data);
  } catch {
    return Response.json({ error: "core_unreachable" }, { status: 502 });
  }
}
