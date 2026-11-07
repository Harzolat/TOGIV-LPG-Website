import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Secret-at-rest encryption (v1.2 §12 / §12.5): AES-256-GCM with a key
 * derived from TOKEN_PEPPER via scrypt. Used for TOTP secrets — stolen
 * database backups must not yield usable second factors.
 *
 * Format: base64(iv | authTag | ciphertext) — self-describing, 12+16 prefix.
 */

const KEY = scryptSync(process.env.TOKEN_PEPPER ?? "dev-pepper-change-in-production", "togi-totp-v1", 32);

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptSecret(payload: string): string {
  const raw = Buffer.from(payload, "base64");
  if (raw.length < 12 + 16 + 1) throw new Error("Encrypted payload too short.");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
