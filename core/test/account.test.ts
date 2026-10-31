import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { MAX_VERIFY_ATTEMPTS, OtpError, OtpService, otpMessage, RESEND_AFTER_MS, SEND_WINDOW_MS, singlePartLimit } from "../src/account/otp.js";
import { MemoryAccountStore } from "../src/account/store.js";
import { createToken, verifyToken } from "../src/account/token.js";
import { createAgent, type LlmTurnInput, type LlmTurnOutput } from "../src/agent/index.js";
import { LocalSchemeRetriever } from "../src/agent/retriever.js";
import { loadEngine } from "../src/engine/index.js";
import { createApp } from "../src/server.js";
import type { SmsSender } from "../src/sms/sender.js";

const SECRET = "test-secret-test-secret-test-secret";
const PHONE = "+919876543210";

/** Captures messages instead of sending them; the OTP is read back from the text. */
class CaptureSms implements SmsSender {
  readonly name = "capture";
  sent: { to: string; text: string }[] = [];
  fail = false;
  async send(to: string, text: string) {
    if (this.fail) return { ok: false as const, error: "gateway down" };
    this.sent.push({ to, text });
    return { ok: true as const, id: null };
  }
  lastCode() {
    return this.sent.at(-1)?.text.match(/\d{6}/)?.[0] ?? "";
  }
}

describe("login tokens", () => {
  it("round-trips, and rejects tampering and expiry", () => {
    const token = createToken(PHONE, SECRET, 1000, 5000);
    expect(verifyToken(token, SECRET, 2000)).toBe(PHONE);
    expect(verifyToken(token, SECRET, 7000)).toBeNull();
    expect(verifyToken(token, "another-secret-another-secret-123", 2000)).toBeNull();
    const [payload, mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ phone: "+919999999999", exp: 9e15 })).toString("base64url");
    expect(verifyToken(`${forged}.${mac}`, SECRET, 2000)).toBeNull();
    expect(verifyToken(`${payload}.`, SECRET, 2000)).toBeNull();
    expect(verifyToken(undefined, SECRET)).toBeNull();
  });
});

describe("OtpService", () => {
  const setup = () => {
    const store = new MemoryAccountStore();
    const sms = new CaptureSms();
    return { store, sms, otp: new OtpService(store, sms, SECRET) };
  };

  it("sends a 6-digit code to the normalised number and logs in with it once", async () => {
    const { otp, sms, store } = setup();
    expect(await otp.send("98765 43210", "hi", 0)).toBe(PHONE);
    expect(sms.sent[0]!.to).toBe(PHONE);
    expect(sms.sent[0]!.text).toContain("योजना दर्शक");
    expect(store.otps.get(PHONE)!.codeHash).not.toContain(sms.lastCode()); // stored hashed
    const { token } = await otp.verify(PHONE, sms.lastCode(), 1000);
    expect(verifyToken(token, SECRET, 1000)).toBe(PHONE);
    await expect(otp.verify(PHONE, sms.lastCode(), 2000)).rejects.toMatchObject({ code: "invalid_code" }); // used up
  });

  it("rejects bad numbers, wrong codes, expired codes and too many attempts", async () => {
    const { otp, sms } = setup();
    await expect(otp.send("12345")).rejects.toBeInstanceOf(OtpError);
    await otp.send(PHONE, "en", 0);
    const wrong = sms.lastCode() === "000000" ? "111111" : "000000";
    await expect(otp.verify(PHONE, wrong, 10)).rejects.toMatchObject({ code: "invalid_code" });
    await expect(otp.verify(PHONE, sms.lastCode(), 10 * 60 * 1000)).rejects.toMatchObject({ code: "expired" });
    for (let i = 1; i < MAX_VERIFY_ATTEMPTS; i++) await otp.verify(PHONE, wrong, 20).catch(() => {});
    await expect(otp.verify(PHONE, sms.lastCode(), 30)).rejects.toMatchObject({ code: "too_many_attempts" });
  });

  it("limits how often codes are sent", async () => {
    const { otp, sms } = setup();
    await otp.send(PHONE, "en", 0);
    await expect(otp.send(PHONE, "en", 1000)).rejects.toMatchObject({ code: "too_soon" });
    await otp.send(PHONE, "en", RESEND_AFTER_MS + 1);
    await otp.send(PHONE, "en", 2 * RESEND_AFTER_MS + 2);
    await expect(otp.send(PHONE, "en", 3 * RESEND_AFTER_MS + 3)).rejects.toMatchObject({ code: "too_many_codes" });
    await otp.send(PHONE, "en", SEND_WINDOW_MS + 1); // new window
    expect(sms.sent).toHaveLength(4);
  });

  it("fits the code SMS in one part in every language", () => {
    for (const lang of ["hi", "mr", "en"] as const) {
      const text = otpMessage(lang, "123456");
      expect(text.length).toBeLessThanOrEqual(singlePartLimit(text));
    }
  });

  it("reports an SMS failure", async () => {
    const { otp, sms } = setup();
    sms.fail = true;
    await expect(otp.send(PHONE)).rejects.toMatchObject({ code: "sms_failed", status: 502 });
  });
});

describe("account endpoints and profile-aware turns", () => {
  const engine = loadEngine();
  const base = (): LlmTurnOutput => ({
    facts: {}, landArea: null, language: "en", switchLanguageTo: null, topics: [], intent: "give_info", pickedSchemeId: null,
    otherPhoneNumber: null, scam: { detected: false, pattern: null }, answer: null, sources: [], aboutSomeoneElse: false,
  });
  const inputs: LlmTurnInput[] = [];
  const agent = createAgent({
    engine,
    retriever: new LocalSchemeRetriever(engine.schemes),
    llm: {
      turn: async (input) => {
        inputs.push(input);
        if (input.userText === "I am 35") return { ...base(), facts: { age: 35 } };
        return { ...base(), topics: ["insurance"] };
      },
    },
  });
  const store = new MemoryAccountStore();
  const sms = new CaptureSms();
  const server = createApp(agent, { sms, accounts: { store, secret: SECRET } }).listen(0);
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  afterAll(() => void server.close());

  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const res = await fetch(url + path, {
      method,
      headers: { "content-type": "application/json", ...(token ? { "x-user-token": token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  it("signs up with a password, logs in, then saves and reads a profile", async () => {
    expect((await call("POST", "/auth/signup", { phone: "12345", password: "secret123" })).body.error).toBe("invalid_phone");
    expect((await call("POST", "/auth/signup", { phone: "9876543210", password: "short1" })).body.error).toBe("weak_password");
    expect((await call("POST", "/auth/signup", { phone: "9876543210", password: "onlyletters" })).body.error).toBe("weak_password");
    const signup = await call("POST", "/auth/signup", { phone: "98765 43210", password: "khet2026pass", lang: "mr" });
    expect(signup.status).toBe(201);
    expect(signup.body.profile).toEqual({ phone: PHONE, name: null, lang: "mr", facts: {}, documents: [], consent: false }); // no hash leaked
    expect((await store.getProfile(PHONE))!.passwordHash).toMatch(/^scrypt\$/);
    expect((await call("POST", "/auth/signup", { phone: "9876543210", password: "another123" })).status).toBe(409);

    expect((await call("POST", "/auth/login", { phone: "9876543210", password: "wrongpass1" })).body.error).toBe("invalid_credentials");
    expect((await call("POST", "/auth/login", { phone: "9123456789", password: "khet2026pass" })).body.error).toBe("invalid_credentials");
    const login = await call("POST", "/auth/login", { phone: "+91 98765 43210", password: "khet2026pass" });
    expect(login.status).toBe(200);
    const token = login.body.token as string;
    expect(verifyToken(token, SECRET)).toBe(PHONE);

    expect((await call("GET", "/me")).status).toBe(401);
    // Facts aren't stored without consent.
    expect((await call("PUT", "/me", { facts: { age: 40 } }, token)).body.facts).toEqual({});
    const saved = await call("PUT", "/me", { name: "Asha", consent: true, facts: { age: 40, state: "MH", bogus: 1, gender: "robot" } }, token);
    expect(saved.body).toMatchObject({ name: "Asha", consent: true, facts: { age: 40, state: "MH" } });
    expect((await call("GET", "/me", undefined, token)).body.facts).toEqual({ age: 40, state: "MH" });
    // Saving the profile keeps the password.
    expect((await call("POST", "/auth/login", { phone: "9876543210", password: "khet2026pass" })).status).toBe(200);
  });

  it("locks a number after repeated wrong passwords", async () => {
    await call("POST", "/auth/signup", { phone: "9000000001", password: "lockme1234" });
    for (let i = 0; i < 5; i++) await call("POST", "/auth/login", { phone: "9000000001", password: "nope12345" });
    expect((await call("POST", "/auth/login", { phone: "9000000001", password: "lockme1234" })).status).toBe(429);
  });

  it("has OTP login switched off", async () => {
    const res = await fetch(`${url}/auth/otp/send`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(404);
  });

  it("starts a logged-in chat from the saved profile and saves what it learns", async () => {
    const token = createToken(PHONE, SECRET);
    const first = await call("POST", "/turn", { sessionId: "web-1", text: "", lang: "en", channel: "web" }, token);
    expect((first.body.trace as { facts: Record<string, unknown> }).facts).toMatchObject({ age: 40, state: "MH" });
    await call("POST", "/turn", { sessionId: "web-1", text: "I am 35", channel: "web" }, token);
    await new Promise((r) => setTimeout(r, 20)); // saving happens after the response
    expect((await store.getProfile(PHONE))!.facts.age).toBe(35);

    // Someone else can't continue this chat.
    expect((await call("POST", "/turn", { sessionId: "web-1", text: "hi", channel: "web" })).status).toBe(403);
  });

  it("recognises a caller with a saved profile on the phone line", async () => {
    const r = await call("POST", "/turn", { sessionId: "call-1", text: "", lang: "hi", channel: "phone", callerNumber: PHONE });
    expect((r.body.trace as { facts: Record<string, unknown> }).facts).toMatchObject({ age: 35, state: "MH" });
  });

  it("withdrawing consent deletes saved answers; deleting removes the profile", async () => {
    const token = createToken(PHONE, SECRET);
    expect((await call("PUT", "/me", { consent: false }, token)).body).toMatchObject({ consent: false, facts: {} });
    expect((await call("DELETE", "/me", undefined, token)).status).toBe(200);
    expect((await call("GET", "/me", undefined, token)).status).toBe(404);
  });

  it("serves the scheme catalogue", async () => {
    const r = await call("GET", "/catalog");
    expect((r.body.schemes as unknown[]).length).toBe(engine.schemes.length);
    expect((r.body.facts as Record<string, { ask: unknown }>).age!.ask).toBeTruthy();
  });
});
