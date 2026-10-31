import { timingSafeEqual } from "node:crypto";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import { z } from "zod";
import type { Agent } from "./agent/index.js";
import { LiveBus, maskNumber } from "./live.js";
import { composeChecklistSms } from "./sms/checklist.js";
import { LogSender, type SmsSender } from "./sms/sender.js";

const turnBody = z.object({
  sessionId: z.string().min(1).max(128),
  text: z.string().max(2000).default(""),
  lang: z.enum(["hi", "mr", "en"]).optional(),
  callerNumber: z.string().max(32).optional(),
  channel: z.string().max(32).optional(),
});

export type ServerOptions = {
  /** If set, requests must send `Authorization: Bearer <apiKey>` (voice worker → core). */
  apiKey?: string;
  /** If set, browsers from this origin may call the API directly (text chat page). */
  corsOrigin?: string;
  /** If set, the live panel endpoints require `?token=<liveToken>` (EventSource can't send headers). */
  liveToken?: string;
  bus?: LiveBus;
  /** Sends the checklist SMS at call end. Defaults to a dry run that only logs. */
  sms?: SmsSender;
};

const HEARTBEAT_MS = 15_000;

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function bearerAuth(apiKey: string): RequestHandler {
  return (req, res, next) => {
    if (safeEqual(req.get("authorization") ?? "", `Bearer ${apiKey}`)) return next();
    res.status(401).json({ error: "unauthorized" });
  };
}

function tokenAuth(token: string | undefined): RequestHandler {
  return (req, res, next) => {
    if (!token || safeEqual(String(req.query.token ?? ""), token)) return next();
    res.status(401).json({ error: "unauthorized" });
  };
}

function cors(origin: string): RequestHandler {
  return (req, res, next) => {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") return void res.sendStatus(204);
    next();
  };
}

export function createApp(agent: Agent, { apiKey, corsOrigin, liveToken, bus = new LiveBus(), sms = new LogSender() }: ServerOptions = {}) {
  const app = express();
  app.disable("x-powered-by");
  if (corsOrigin) app.use(cors(corsOrigin));
  app.use(express.json({ limit: "16kb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Live panel (read-only). Guarded by its own token because browsers can't send the worker's bearer key.
  const live = express.Router();
  live.use(tokenAuth(liveToken));

  live.get("/meta", (_req, res) => {
    const { schemes, facts } = agent.engine;
    res.json({
      schemes: schemes.map((s) => ({
        id: s.id,
        name: s.name,
        level: s.level,
        state: s.state ?? null,
        topics: s.topics,
        source: s.source,
        lastVerified: s.lastVerified ?? null,
      })),
      facts: Object.fromEntries(
        Object.entries(facts).map(([key, f]) => [key, { label: f.ask?.en ?? f.description ?? key, askable: f.askable, type: f.type }]),
      ),
    });
  });

  live.get("/sessions", (_req, res) => {
    res.json(bus.snapshot());
  });

  live.get("/events", (req, res) => {
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.flushHeaders();
    const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    send({ type: "snapshot", sessions: bus.snapshot() });
    const unsubscribe = bus.subscribe(send);
    const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  app.use("/live", live);

  if (apiKey) app.use(bearerAuth(apiKey));

  const meta = (sessionId: string) => {
    const s = agent.store.get(sessionId);
    return { channel: s?.channel ?? "unknown", callerNumber: s?.callerNumber ?? null };
  };

  app.post("/turn", async (req, res) => {
    const body = turnBody.safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: "invalid_request", details: body.error.issues });
    const { sessionId, text, lang, callerNumber, channel } = body.data;
    const result = await agent.handleTurn(sessionId, text, lang, { callerNumber, channel });
    bus.recordTurn(sessionId, meta(sessionId), text, result);
    res.json(result);
  });

  /** Explicit language choice from a channel (keypad 1/2 on a call, buttons on the browser page). */
  app.post("/sessions/:id/language", (req, res) => {
    const body = z.object({ lang: z.enum(["hi", "mr", "en"]) }).safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: "invalid_request", details: body.error.issues });
    const result = agent.setLanguage(req.params.id, body.data.lang);
    if (!result) return void res.status(404).json({ error: "unknown_session" });
    bus.recordTurn(req.params.id, meta(req.params.id), "", result);
    res.json(result);
  });

  /** Called by a channel when the call ends (hang-up). Persistence to Supabase hooks in here later. */
  app.post("/sessions/:id/end", async (req, res) => {
    const s = agent.store.get(req.params.id);
    agent.store.delete(req.params.id);
    bus.recordEnd(req.params.id);
    res.json({ ended: !!s });
    // Sent at call end, so a dropped call still gets its checklist; the session is gone, so it is sent once.
    if (!s?.checklist) return;
    const { to, schemeIds, lang } = s.checklist;
    const body = composeChecklistSms(agent.engine, schemeIds, s.stated, lang);
    if (!body) return;
    const result = await sms.send(to, body);
    if (result.ok) console.log(`Checklist SMS sent via ${sms.name} to ${maskNumber(to)}${result.id ? ` (id ${result.id})` : ""}`);
    else console.error(`Checklist SMS via ${sms.name} to ${maskNumber(to)} failed: ${result.error}`);
  });

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err?.type === "entity.parse.failed") return void res.status(400).json({ error: "invalid_json" });
    if (err?.type === "entity.too.large") return void res.status(413).json({ error: "too_large" });
    console.error("Request failed:", err);
    res.status(500).json({ error: "internal_error" });
  };
  app.use(onError);
  return app;
}
