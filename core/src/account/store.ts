import type { Facts, Lang } from "../engine/index.js";
import type { SupabaseRest } from "../rag/store.js";

export type Profile = {
  phone: string;
  name: string | null;
  lang: Lang;
  facts: Facts;
  /** When the user agreed to save their answers; facts are only read and saved after this. */
  consentAt: string | null;
  /** scrypt hash (src/account/password.ts); null for profiles created by the (disabled) OTP login. */
  passwordHash: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OtpRecord = {
  phone: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
  /** Codes sent in the current rate-limit window, and when that window started. */
  sendCount: number;
  windowStart: number;
  lastSentAt: number;
};

export interface AccountStore {
  getProfile(phone: string): Promise<Profile | null>;
  saveProfile(profile: Profile): Promise<Profile>;
  deleteProfile(phone: string): Promise<void>;
  getOtp(phone: string): Promise<OtpRecord | null>;
  saveOtp(record: OtpRecord): Promise<void>;
  deleteOtp(phone: string): Promise<void>;
}

/** For tests and for running without Supabase (nothing survives a restart). */
export class MemoryAccountStore implements AccountStore {
  profiles = new Map<string, Profile>();
  otps = new Map<string, OtpRecord>();
  async getProfile(phone: string) {
    return this.profiles.get(phone) ?? null;
  }
  async saveProfile(p: Profile) {
    this.profiles.set(p.phone, p);
    return p;
  }
  async deleteProfile(phone: string) {
    this.profiles.delete(phone);
  }
  async getOtp(phone: string) {
    return this.otps.get(phone) ?? null;
  }
  async saveOtp(r: OtpRecord) {
    this.otps.set(r.phone, r);
  }
  async deleteOtp(phone: string) {
    this.otps.delete(phone);
  }
}

type ProfileRow = {
  phone: string;
  name: string | null;
  lang: Lang;
  facts: Facts;
  consent_at: string | null;
  password_hash: string | null;
  created_at: string;
  updated_at: string;
};
type OtpRow = { phone: string; code_hash: string; expires_at: string; attempts: number; send_count: number; window_start: string; last_sent_at: string };

const eq = (phone: string) => `phone=eq.${encodeURIComponent(phone)}`;
const upsert = { Prefer: "resolution=merge-duplicates,return=representation" };

/** Profiles and OTP codes in Supabase (tables from core/db/app.sql), over the HTTPS REST API with the secret key. */
export class SupabaseAccountStore implements AccountStore {
  constructor(private db: SupabaseRest) {}

  async getProfile(phone: string) {
    const rows = await this.db.request<ProfileRow[]>(`/profiles?${eq(phone)}&select=*`);
    return rows[0] ? fromProfileRow(rows[0]) : null;
  }

  async saveProfile(p: Profile) {
    const rows = await this.db.request<ProfileRow[]>("/profiles?on_conflict=phone", {
      method: "POST",
      headers: upsert,
      body: {
        phone: p.phone,
        name: p.name,
        lang: p.lang,
        facts: p.facts,
        consent_at: p.consentAt,
        password_hash: p.passwordHash,
        created_at: p.createdAt,
        updated_at: p.updatedAt,
      },
    });
    return fromProfileRow(rows[0]!);
  }

  async deleteProfile(phone: string) {
    await this.db.request(`/profiles?${eq(phone)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  }

  async getOtp(phone: string) {
    const rows = await this.db.request<OtpRow[]>(`/otp_codes?${eq(phone)}&select=*`);
    const r = rows[0];
    if (!r) return null;
    return {
      phone: r.phone,
      codeHash: r.code_hash,
      expiresAt: Date.parse(r.expires_at),
      attempts: r.attempts,
      sendCount: r.send_count,
      windowStart: Date.parse(r.window_start),
      lastSentAt: Date.parse(r.last_sent_at),
    };
  }

  async saveOtp(r: OtpRecord) {
    await this.db.request("/otp_codes?on_conflict=phone", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: {
        phone: r.phone,
        code_hash: r.codeHash,
        expires_at: new Date(r.expiresAt).toISOString(),
        attempts: r.attempts,
        send_count: r.sendCount,
        window_start: new Date(r.windowStart).toISOString(),
        last_sent_at: new Date(r.lastSentAt).toISOString(),
      },
    });
  }

  async deleteOtp(phone: string) {
    await this.db.request(`/otp_codes?${eq(phone)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  }
}

function fromProfileRow(r: ProfileRow): Profile {
  return {
    phone: r.phone,
    name: r.name,
    lang: r.lang,
    facts: r.facts ?? {},
    consentAt: r.consent_at,
    passwordHash: r.password_hash,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
