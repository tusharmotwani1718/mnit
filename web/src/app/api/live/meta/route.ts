import { connection } from "next/server";
import { coreLiveUrl } from "@/lib/server/core";

export async function GET() {
  await connection();
  try {
    const res = await fetch(coreLiveUrl("/meta"), { cache: "no-store" });
    if (!res.ok) return Response.json({ error: "core_error", status: res.status }, { status: 502 });
    return Response.json(await res.json());
  } catch {
    return Response.json({ error: "core_unreachable" }, { status: 502 });
  }
}
