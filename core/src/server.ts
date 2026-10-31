import { timingSafeEqual } from "node:crypto";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import { z } from "zod";
// import { OtpError, OtpService } from "./account/otp.js"; // OTP login switched off, see /auth routes
import { checkPassword, hashPassword, PASSWORD_RULE } from "./account/password.js";
import type { AccountStore, Profile } from "./account/store.js";
import { createToken, verifyToken } from "./account/token.js";
import type { Agent } from "./agent/index.js";
import { cleanFacts, readiness, type Facts } from "./engine/index.js";
import { LiveBus, maskNumber } from "./live.js";
import { toIndianMobile } from "./sms/number.js";
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
  /** Sends the checklist SMS at call end, and login codes. Defaults to a dry run that only logs. */
  sms?: SmsSender;
  /** Citizen accounts (phone + OTP login, saved profiles). Without it the /auth and /me endpoints answer 503. */
  accounts?: { store: AccountStore; secret: string };
};

const langSchema = z.enum(["hi", "mr", "en"]);
const USER_TOKEN_HEADER = "x-user-token";
// /** OTP requests per client IP per hour (on top of the per-phone limits in OtpService). */
// const OTP_SENDS_PER_IP = 10;
// const IP_WINDOW_MS = 60 * 60 * 1000;
/** Wrong passwords allowed per number before a 15-minute lockout. */
const MAX_LOGIN_FAILURES = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

// Never includes the password hash.
const profileView = (p: Profile) => ({
  phone: p.phone,
  name: p.name,
  lang: p.lang,
  facts: p.facts,
  documents: p.documents,
  consent: !!p.consentAt,
});

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

export function createApp(
  agent: Agent,
  { apiKey, corsOrigin, liveToken, bus = new LiveBus(), sms = new LogSender(), accounts }: ServerOptions = {},
) {
  // const otp = accounts ? new OtpService(accounts.store, sms, accounts.secret) : null;
  // const ipSends = new Map<string, { count: number; start: number }>();
  const loginFailures = new Map<string, { count: number; start: number }>();
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

  /** Phone number of the logged-in user (the web app passes their token), or null for guests. */
  const userPhone = (req: express.Request) => (accounts ? verifyToken(req.get(USER_TOKEN_HEADER), accounts.secret) : null);

  const loadProfile = async (phone: string) => {
    try {
      return await accounts!.store.getProfile(phone);
    } catch (err) {
      console.error("Profile lookup failed:", err instanceof Error ? err.message : err);
      return null;
    }
  };

  /** Saves what the session learned to its profile (only sessions started from a consented profile have profilePhone). */
  const saveSessionFacts = async (sessionId: string) => {
    const s = agent.store.get(sessionId);
    if (!accounts || !s?.profilePhone) return;
    try {
      const profile = await accounts.store.getProfile(s.profilePhone);
      if (!profile?.consentAt) return;
      await accounts.store.saveProfile({ ...profile, facts: cleanFacts(agent.engine.facts, s.stated), updatedAt: new Date().toISOString() });
    } catch (err) {
      console.error("Saving profile facts failed:", err instanceof Error ? err.message : err);
    }
  };

  app.post("/turn", async (req, res) => {
    const body = turnBody.safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: "invalid_request", details: body.error.issues });
    const { sessionId, text, lang, channel } = body.data;
    let { callerNumber } = body.data;
    const user = userPhone(req);
    const existing = agent.store.get(sessionId);

    // A logged-in web chat belongs to that user: another user (or a guest) can't continue it.
    if (existing?.channel === "web" && existing.callerNumber && existing.callerNumber !== user) {
      return void res.status(403).json({ error: "session_belongs_to_another_user" });
    }

    let knownFacts: Facts | undefined;
    let profilePhone: string | undefined;
    if (!existing) {
      if (user) callerNumber = user; // the SMS checklist goes to the logged-in number
      const phone = user ?? (channel === "phone" ? toIndianMobile(callerNumber) : null);
      if (phone && accounts) {
        const profile = await loadProfile(phone);
        if (profile?.consentAt) {
          knownFacts = cleanFacts(agent.engine.facts, profile.facts);
          profilePhone = phone;
        }
      }
    }

    const result = await agent.handleTurn(sessionId, text, lang, { callerNumber, channel, knownFacts, profilePhone });
    bus.recordTurn(sessionId, meta(sessionId), text, result);
    res.json(result);
    void saveSessionFacts(sessionId);
  });

  /** Everything the web app needs to show schemes and edit a profile, in hi / mr / en. */
  app.get("/catalog", (_req, res) => {
    const { schemes, facts } = agent.engine;
    res.json({
      schemes: schemes.map((s) => ({
        id: s.id,
        name: s.name,
        level: s.level,
        state: s.state ?? null,
        topics: s.topics,
        benefitSummary: s.benefitSummary,
        documents: s.documents,
        applyAt: s.applyAt,
        applyAtSpoken: s.applyAtSpoken,
        helpline: s.helpline,
        source: s.source,
        lastVerified: s.lastVerified ?? null,
      })),
      facts: Object.fromEntries(
        Object.entries(facts).map(([key, f]) => [
          key,
          { type: f.type, values: f.values ?? null, askable: f.askable, ask: f.ask ?? null, description: f.description ?? null, topics: f.topics ?? null },
        ]),
      ),
    });
  });

  /**
   * Application readiness for one scheme (see engine/readiness.ts). Uses the logged-in user's saved answers and documents
   * (if they agreed to saving) plus whatever the request adds; what the request adds is saved back to the profile.
   */
  app.post("/schemes/:id/readiness", async (req, res) => {
    const scheme = agent.engine.schemes.find((s) => s.id === req.params.id);
    if (!scheme) return void res.status(404).json({ error: "unknown_scheme" });
    const body = z
      .object({
        facts: z.record(z.string(), z.union([z.string().max(40), z.number(), z.boolean(), z.null()])).optional(),
        documents: z.array(z.string().max(200)).max(30).optional(),
      })
      .safeParse(req.body ?? {});
    if (!body.success) return void res.status(400).json({ error: "invalid_request", details: body.error.issues });

    const user = userPhone(req);
    const profile = user && accounts ? await loadProfile(user) : null;
    const consented = !!profile?.consentAt;
    const merged: Record<string, unknown> = { ...(consented ? profile!.facts : {}) };
    for (const [k, v] of Object.entries(body.data.facts ?? {})) {
      if (v === null) delete merged[k];
      else merged[k] = v;
    }
    const facts = cleanFacts(agent.engine.facts, merged);
    const schemeDocs = new Set(scheme.documents.map((d) => d.en));
    const documents = (body.data.documents ?? (consented ? profile!.documents : [])).filter((d) => schemeDocs.has(d));

    if (consented && (body.data.facts || body.data.documents)) {
      const otherDocs = profile!.documents.filter((d) => !schemeDocs.has(d));
      try {
        await accounts!.store.saveProfile({ ...profile!, facts, documents: [...otherDocs, ...documents], updatedAt: new Date().toISOString() });
      } catch (err) {
        console.error("Saving readiness answers failed:", err instanceof Error ? err.message : err);
      }
    }
    res.json({ ...readiness(scheme, facts, documents, agent.engine.facts), known: facts, documentsHave: documents, saved: consented });
  });

  // --- Citizen accounts: phone + password login and saved profiles --------------------------------------------------
  const requireAccounts: RequestHandler = (_req, res, next) => {
    if (accounts) return next();
    res.status(503).json({ error: "accounts_disabled" });
  };

  const credentials = z.object({ phone: z.string().max(20), password: z.string().max(200), lang: langSchema.optional() });

  app.post("/auth/signup", requireAccounts, async (req, res) => {
    const body = credentials.safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: "invalid_request" });
    const phone = toIndianMobile(body.data.phone);
    if (!phone) return void res.status(400).json({ error: "invalid_phone" });
    if (!PASSWORD_RULE.test(body.data.password)) return void res.status(400).json({ error: "weak_password" });
    const existing = await accounts!.store.getProfile(phone);
    if (existing?.passwordHash) return void res.status(409).json({ error: "phone_taken" });
    const now = new Date().toISOString();
    const profile = await accounts!.store.saveProfile({
      ...(existing ?? { phone, name: null, facts: {}, documents: [], consentAt: null, createdAt: now }),
      lang: body.data.lang ?? existing?.lang ?? "hi",
      passwordHash: await hashPassword(body.data.password),
      updatedAt: now,
    });
    res.status(201).json({ token: createToken(phone, accounts!.secret), profile: profileView(profile) });
  });

  app.post("/auth/login", requireAccounts, async (req, res) => {
    const body = credentials.safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: "invalid_credentials" });
    const phone = toIndianMobile(body.data.phone);
    if (!phone) return void res.status(400).json({ error: "invalid_phone" });
    const now = Date.now();
    const f = loginFailures.get(phone);
    const window = f && now - f.start < LOGIN_WINDOW_MS ? f : { count: 0, start: now };
    if (window.count >= MAX_LOGIN_FAILURES) return void res.status(429).json({ error: "too_many_logins" });
    const profile = await accounts!.store.getProfile(phone);
    // Same answer for an unknown number and a wrong password, so the endpoint doesn't reveal who has an account.
    if (!profile || !(await checkPassword(body.data.password, profile.passwordHash))) {
      loginFailures.set(phone, { ...window, count: window.count + 1 });
      return void res.status(401).json({ error: "invalid_credentials" });
    }
    loginFailures.delete(phone);
    res.json({ token: createToken(phone, accounts!.secret), profile: profileView(profile) });
  });

  // OTP login is switched off for now: the SMS gateway's SIM rejects the messages (RESULT_RIL_GENERIC_ERROR).
  // OtpService (src/account/otp.ts) and its tests are kept; uncomment these routes to bring it back.
  // app.post("/auth/otp/send", requireAccounts, async (req, res) => {
  //   const body = z.object({ phone: z.string().max(20), lang: langSchema.optional() }).safeParse(req.body);
  //   if (!body.success) return void res.status(400).json({ error: "invalid_request" });
  //   const ip = req.get("x-client-ip") || req.ip || "unknown";
  //   const now = Date.now();
  //   const w = ipSends.get(ip);
  //   const window = w && now - w.start < IP_WINDOW_MS ? w : { count: 0, start: now };
  //   if (window.count >= OTP_SENDS_PER_IP) return void res.status(429).json({ error: "too_many_codes" });
  //   try {
  //     await otp!.send(body.data.phone, body.data.lang);
  //     ipSends.set(ip, { ...window, count: window.count + 1 });
  //     res.json({ sent: true });
  //   } catch (err) {
  //     if (err instanceof OtpError) return void res.status(err.status).json({ error: err.code, retryAfterSec: err.retryAfterSec ?? null });
  //     throw err;
  //   }
  // });
  //
  // app.post("/auth/otp/verify", requireAccounts, async (req, res) => {
  //   const body = z.object({ phone: z.string().max(20), code: z.string().regex(/^\s*\d{6}\s*$/), lang: langSchema.optional() }).safeParse(req.body);
  //   if (!body.success) return void res.status(400).json({ error: "invalid_code" });
  //   try {
  //     const { phone, token } = await otp!.verify(body.data.phone, body.data.code);
  //     const now = new Date().toISOString();
  //     const profile =
  //       (await accounts!.store.getProfile(phone)) ??
  //       (await accounts!.store.saveProfile({ phone, name: null, lang: body.data.lang ?? "hi", facts: {}, consentAt: null, createdAt: now, updatedAt: now }));
  //     res.json({ token, profile: profileView(profile) });
  //   } catch (err) {
  //     if (err instanceof OtpError) return void res.status(err.status).json({ error: err.code });
  //     throw err;
  //   }
  // });

  const requireUser: RequestHandler = (req, res, next) => {
    const phone = userPhone(req);
    if (!phone) return void res.status(401).json({ error: "not_logged_in" });
    res.locals.phone = phone;
    next();
  };

  app.get("/me", requireAccounts, requireUser, async (_req, res) => {
    const profile = await accounts!.store.getProfile(res.locals.phone as string);
    if (!profile) return void res.status(404).json({ error: "no_profile" });
    res.json(profileView(profile));
  });

  app.put("/me", requireAccounts, requireUser, async (req, res) => {
    const body = z
      .object({
        name: z.string().trim().max(80).nullable().optional(),
        lang: langSchema.optional(),
        consent: z.boolean().optional(),
        /** Merged into saved facts; null removes a fact. */
        facts: z.record(z.string(), z.union([z.string().max(40), z.number(), z.boolean(), z.null()])).optional(),
      })
      .safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: "invalid_request", details: body.error.issues });
    const phone = res.locals.phone as string;
    const now = new Date().toISOString();
    const current: Profile = (await accounts!.store.getProfile(phone)) ?? {
      phone, name: null, lang: "hi", facts: {}, documents: [], consentAt: null, passwordHash: null, createdAt: now, updatedAt: now,
    };
    const { name, lang, consent, facts } = body.data;
    let nextFacts = current.facts;
    if (facts) {
      const merged: Record<string, unknown> = { ...current.facts };
      for (const [k, v] of Object.entries(facts)) {
        if (v === null) delete merged[k];
        else merged[k] = v;
      }
      nextFacts = cleanFacts(agent.engine.facts, merged);
    }
    const consentAt = consent === undefined ? current.consentAt : consent ? (current.consentAt ?? now) : null;
    // Without consent nothing is stored; withdrawing consent deletes the saved answers and documents.
    if (!consentAt) nextFacts = {};
    const saved = await accounts!.store.saveProfile({
      ...current,
      name: name === undefined ? current.name : name || null,
      lang: lang ?? current.lang,
      facts: nextFacts,
      documents: consentAt ? current.documents : [],
      consentAt,
      updatedAt: now,
    });
    res.json(profileView(saved));
  });

  app.delete("/me", requireAccounts, requireUser, async (_req, res) => {
    await accounts!.store.deleteProfile(res.locals.phone as string);
    res.json({ deleted: true });
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
