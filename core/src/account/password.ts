import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/** 8–72 characters with at least one letter and one digit. */
export const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,72}$/;

const KEY_LEN = 32;
const PARAMS: ScryptOptions = { N: 16384, r: 8, p: 1 };

const derive = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => scrypt(password, salt, KEY_LEN, PARAMS, (err, key) => (err ? reject(err) : resolve(key))));

/** `scrypt$<salt>$<hash>` (base64url), with a random salt per password. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64url")}$${(await derive(password, salt)).toString("base64url")}`;
}

export async function checkPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const [scheme, salt, hash] = (stored ?? "").split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const given = await derive(password, Buffer.from(salt, "base64url"));
  return expected.length === given.length && timingSafeEqual(expected, given);
}
