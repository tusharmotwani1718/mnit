import { maskNumber } from "../live.js";

export type SmsResult = { ok: true; id: string | null } | { ok: false; error: string };

export interface SmsSender {
  readonly name: string;
  send(to: string, text: string): Promise<SmsResult>;
}

const TIMEOUT_MS = 10_000;

const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

async function failure(res: Response): Promise<SmsResult> {
  const body = (await res.text().catch(() => "")).slice(0, 200);
  return { ok: false, error: `HTTP ${res.status}${body ? `: ${body}` : ""}` };
}

/**
 * "SMS Gateway for Android" (sms-gate.app): an Android phone sends the SMS from its own SIM.
 * Person-to-person SMS, so no DLT registration. `url` is the cloud API (https://api.sms-gate.app/3rdparty/v1)
 * or the phone's local server (http://<phone-ip>:8080); both take the same request.
 */
export class AndroidGatewaySender implements SmsSender {
  readonly name = "android";
  constructor(private opts: { url: string; username: string; password: string }) {}

  async send(to: string, text: string): Promise<SmsResult> {
    try {
      const res = await fetch(`${this.opts.url.replace(/\/$/, "")}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: basic(this.opts.username, this.opts.password) },
        body: JSON.stringify({ textMessage: { text }, phoneNumbers: [to] }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return failure(res);
      const data = (await res.json().catch(() => ({}))) as { id?: string };
      return { ok: true, id: data.id ?? null };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

/** Twilio Messages API. On a trial account it only reaches verified numbers. */
export class TwilioSender implements SmsSender {
  readonly name = "twilio";
  constructor(private opts: { accountSid: string; authToken: string; from: string }) {}

  async send(to: string, text: string): Promise<SmsResult> {
    try {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.opts.accountSid}/Messages.json`, {
        method: "POST",
        headers: { Authorization: basic(this.opts.accountSid, this.opts.authToken) },
        body: new URLSearchParams({ To: to, From: this.opts.from, Body: text }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return failure(res);
      const data = (await res.json().catch(() => ({}))) as { sid?: string };
      return { ok: true, id: data.sid ?? null };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

/** Dry run: prints the message instead of sending it (no provider configured). */
export class LogSender implements SmsSender {
  readonly name = "log";
  async send(to: string, text: string): Promise<SmsResult> {
    console.log(`[sms dry run] to ${maskNumber(to)}:\n${text}`);
    return { ok: true, id: null };
  }
}

/** SMS_PROVIDER = android | twilio | log. Defaults to android when SMS_GATEWAY_URL is set, else log. */
export function createSmsSender(env: NodeJS.ProcessEnv = process.env): SmsSender {
  const provider = env.SMS_PROVIDER || (env.SMS_GATEWAY_URL ? "android" : "log");
  if (provider === "android") {
    const { SMS_GATEWAY_URL: url, SMS_GATEWAY_USER: username, SMS_GATEWAY_PASSWORD: password } = env;
    if (!url || !username || !password) throw new Error("SMS_PROVIDER=android needs SMS_GATEWAY_URL, SMS_GATEWAY_USER and SMS_GATEWAY_PASSWORD");
    return new AndroidGatewaySender({ url, username, password });
  }
  if (provider === "twilio") {
    const { TWILIO_ACCOUNT_SID: accountSid, TWILIO_AUTH_TOKEN: authToken, TWILIO_FROM: from } = env;
    if (!accountSid || !authToken || !from) throw new Error("SMS_PROVIDER=twilio needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM");
    return new TwilioSender({ accountSid, authToken, from });
  }
  if (provider === "log") return new LogSender();
  throw new Error(`Unknown SMS_PROVIDER "${provider}" (use android, twilio or log)`);
}
