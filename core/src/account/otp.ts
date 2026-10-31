import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { Lang } from "../engine/index.js";
import { maskNumber } from "../live.js";
import { toIndianMobile } from "../sms/number.js";
import type { SmsSender } from "../sms/sender.js";
import type { AccountStore } from "./store.js";
import { createToken } from "./token.js";

export const OTP_TTL_MS = 5 * 60 * 1000;
export const MAX_VERIFY_ATTEMPTS = 5;
export const RESEND_AFTER_MS = 30 * 1000;
export const MAX_SENDS_PER_WINDOW = 3;
export const SEND_WINDOW_MS = 15 * 60 * 1000;

/** A failure the API reports as-is: HTTP status plus a stable error code the web app translates. */
export class OtpError extends Error {
  constructor(
    public status: number,
    public code: "invalid_phone" | "too_soon" | "too_many_codes" | "sms_failed" | "invalid_code" | "expired" | "too_many_attempts",
    public retryAfterSec?: number,
  ) {
    super(code);
  }
}

// One SMS part each: Hindi/Marathi (UCS-2) fit 70 characters, English (GSM-7) 160. Multi-part Unicode SMS
// fail on some networks and phones, so the code message stays short.
const MESSAGE: Record<Lang, (code: string) => string> = {
  hi: (c) => `योजना दर्शक कोड: ${c}। 5 मिनट मान्य। किसी को न बताएँ।`,
  mr: (c) => `योजना दर्शक कोड: ${c}. 5 मिनिटे वैध. कोणालाही सांगू नका.`,
  en: (c) => `Yojana Darshak login code: ${c}. Valid for 5 minutes. Don't share it; we never ask for this code on a call.`,
};

/** Characters per single SMS part: 70 if any character needs Unicode (UCS-2), else 160. */
export const singlePartLimit = (text: string) => (/[^\x00-\x7F]/.test(text) ? 70 : 160);

export const otpMessage = (lang: Lang, code: string) => MESSAGE[lang](code);

/** Phone + OTP login. Codes are stored hashed, expire in 5 minutes, and both sending and guessing are rate-limited. */
export class OtpService {
  constructor(
    private store: AccountStore,
    private sms: SmsSender,
    private secret: string,
  ) {}

  private hash(phone: string, code: string) {
    return createHmac("sha256", this.secret).update(`${phone}:${code}`).digest("hex");
  }

  /** Sends a new code. Returns the normalised phone number. */
  async send(rawPhone: string, lang: Lang = "hi", now = Date.now()): Promise<string> {
    const phone = toIndianMobile(rawPhone);
    if (!phone) throw new OtpError(400, "invalid_phone");
    const prev = await this.store.getOtp(phone);
    if (prev && now - prev.lastSentAt < RESEND_AFTER_MS) {
      throw new OtpError(429, "too_soon", Math.ceil((RESEND_AFTER_MS - (now - prev.lastSentAt)) / 1000));
    }
    const inWindow = prev && now - prev.windowStart < SEND_WINDOW_MS;
    const sendCount = inWindow ? prev.sendCount + 1 : 1;
    if (sendCount > MAX_SENDS_PER_WINDOW) {
      throw new OtpError(429, "too_many_codes", Math.ceil((SEND_WINDOW_MS - (now - prev!.windowStart)) / 1000));
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await this.store.saveOtp({
      phone,
      codeHash: this.hash(phone, code),
      expiresAt: now + OTP_TTL_MS,
      attempts: 0,
      sendCount,
      windowStart: inWindow ? prev.windowStart : now,
      lastSentAt: now,
    });
    const result = await this.sms.send(phone, otpMessage(lang, code));
    if (!result.ok) {
      console.error(`OTP SMS via ${this.sms.name} to ${maskNumber(phone)} failed: ${result.error}`);
      throw new OtpError(502, "sms_failed");
    }
    return phone;
  }

  /** Checks a code; on success the code is used up and a login token is returned. */
  async verify(rawPhone: string, code: string, now = Date.now()): Promise<{ phone: string; token: string }> {
    const phone = toIndianMobile(rawPhone);
    if (!phone) throw new OtpError(400, "invalid_phone");
    const rec = await this.store.getOtp(phone);
    if (!rec || rec.codeHash === "") throw new OtpError(401, "invalid_code");
    if (now > rec.expiresAt) throw new OtpError(401, "expired");
    if (rec.attempts >= MAX_VERIFY_ATTEMPTS) throw new OtpError(429, "too_many_attempts");
    const expected = Buffer.from(rec.codeHash);
    const given = Buffer.from(this.hash(phone, code.trim()));
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      await this.store.saveOtp({ ...rec, attempts: rec.attempts + 1 });
      throw new OtpError(401, "invalid_code");
    }
    // Keep the record (for the send rate limit) but make the code unusable.
    await this.store.saveOtp({ ...rec, codeHash: "", expiresAt: 0 });
    return { phone, token: createToken(phone, this.secret, now) };
  }
}
