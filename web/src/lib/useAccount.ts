"use client";

import { useEffect, useState } from "react";
import type { Catalog, Profile } from "./types";

let catalogPromise: Promise<Catalog | null> | null = null;

/** Scheme and question texts from core (fetched once per page load). */
export function useCatalog() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  useEffect(() => {
    catalogPromise ??= fetch("/api/catalog")
      .then((r) => (r.ok ? (r.json() as Promise<Catalog>) : null))
      .catch(() => null);
    let cancelled = false;
    void catalogPromise.then((c) => {
      if (!cancelled) setCatalog(c);
      if (!c) catalogPromise = null; // retry on next mount
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return catalog;
}

/** The logged-in user's profile: undefined while loading, null when logged out. */
export function useMe() {
  const [me, setMe] = useState<Profile | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/me", { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as Profile) : null))
      .catch(() => null)
      .then((p) => {
        if (!cancelled) setMe(p);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return { me, setMe };
}

export async function api<T>(path: string, method: string, body?: unknown): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  try {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, data: (await res.json().catch(() => ({}))) as T & { error?: string } };
  } catch {
    return { ok: false, status: 0, data: { error: "core_unreachable" } as T & { error?: string } };
  }
}
