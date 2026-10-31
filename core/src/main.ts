import { MemoryAccountStore, SupabaseAccountStore, type AccountStore } from "./account/store.js";
import { createDefaultAgent } from "./agent/index.js";
import { SupabaseRest } from "./rag/store.js";
import { createApp } from "./server.js";
import { createSmsSender } from "./sms/sender.js";

const port = Number(process.env.PORT ?? 8080);

/** Accounts need AUTH_SECRET (signs login tokens and hashes OTPs); profiles live in Supabase when it's configured. */
function accounts(): { store: AccountStore; secret: string } | undefined {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    console.warn("AUTH_SECRET missing or shorter than 32 characters: login and profiles are disabled.");
    return undefined;
  }
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY) return { store: new SupabaseAccountStore(new SupabaseRest()), secret };
  console.warn("Supabase not configured: profiles are kept in memory and lost on restart.");
  return { store: new MemoryAccountStore(), secret };
}

const app = createApp(createDefaultAgent(), {
  apiKey: process.env.CORE_API_KEY || undefined,
  corsOrigin: process.env.CORS_ORIGIN || undefined,
  liveToken: process.env.LIVE_VIEW_TOKEN || undefined,
  sms: createSmsSender(),
  accounts: accounts(),
});

app.listen(port, () => {
  console.log(`Yojana Darshak core listening on http://localhost:${port}`);
  if (!process.env.CORE_API_KEY) console.warn("CORE_API_KEY not set: /turn is open to anyone who can reach this port.");
  if (!process.env.LIVE_VIEW_TOKEN) console.warn("LIVE_VIEW_TOKEN not set: /live (call transcripts) is open to anyone who can reach this port.");
});
