import { createDefaultAgent } from "./agent/index.js";
import { createApp } from "./server.js";
import { createSmsSender } from "./sms/sender.js";

const port = Number(process.env.PORT ?? 8080);
const app = createApp(createDefaultAgent(), {
  apiKey: process.env.CORE_API_KEY || undefined,
  corsOrigin: process.env.CORS_ORIGIN || undefined,
  liveToken: process.env.LIVE_VIEW_TOKEN || undefined,
  sms: createSmsSender(),
});

app.listen(port, () => {
  console.log(`Yojana Darshak core listening on http://localhost:${port}`);
  if (!process.env.CORE_API_KEY) console.warn("CORE_API_KEY not set: /turn is open to anyone who can reach this port.");
  if (!process.env.LIVE_VIEW_TOKEN) console.warn("LIVE_VIEW_TOKEN not set: /live (call transcripts) is open to anyone who can reach this port.");
});
