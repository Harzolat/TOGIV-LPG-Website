import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Opaque token + hashing utilities (v1.2 §12 / §1.4.3 / v1.2.1 A3).
 *
 * - Session tokens: 256-bit random, stored SHA-256 hashed, raw never persisted.
 * - QR tokens / status-link tokens: ≥128-bit random, stored SHA-256 hashed.
 * - OTP codes: 6-digit numeric, stored HMAC-SHA256 with server pepper.
 * - No separate cryptographic signature scheme: storage-based validation is
 *   strictly stronger here (revocation, single-use, analytics) — v1.2.1 A3.
 */

const PEPPER = process.env.TOKEN_PEPPER ?? "dev-pepper-change-in-production";

export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url"); // 32 bytes = 256-bit
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateOtpCode(digits = 6): string {
  const max = 10 ** digits;
  const range = 2 ** 32;
  // Correct rejection sampling: reject raw values in the uneven tail so every
  // digit sequence is equally likely (2^32 is not divisible by 10^digits).
  const limit = range - (range % max);
  let raw: number;
  do {
    raw = randomBytes(4).readUInt32BE(0);
  } while (raw >= limit);
  return (raw % max).toString().padStart(digits, "0");
}

export function hashOtp(code: string): string {
  return createHmac("sha256", PEPPER).update(code).digest("hex");
}

export function verifyOtp(code: string, codeHash: string): boolean {
  const a = Buffer.from(hashOtp(code), "hex");
  const b = Buffer.from(codeHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
