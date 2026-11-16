import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";

const BCRYPT_COST = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Sensible baseline policy: length + basic complexity, without over-restricting. */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (password.length > 200) return "Password is too long.";
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must include at least one letter and one number.";
  }
  return null;
}

// Ambiguous glyphs (O/0, I/l/1) are omitted: temporary passwords are read
// aloud or copied by hand by an operator.
const TEMP_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const TEMP_LETTERS =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const TEMP_DIGITS = "23456789";

/**
 * Cryptographically secure temporary password for operator-authorized
 * recovery. Guarantees the existing policy (at least one letter and one
 * digit) so the recovered account can sign in and change it immediately.
 */
export function generateTemporaryPassword(length = 20): string {
  const chars: string[] = [
    TEMP_LETTERS[randomInt(TEMP_LETTERS.length)],
    TEMP_DIGITS[randomInt(TEMP_DIGITS.length)],
  ];
  while (chars.length < Math.max(12, length)) {
    chars.push(TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)]);
  }
  // Fisher–Yates so the guaranteed character classes are not positional.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const tmp = chars[i];
    chars[i] = chars[j];
    chars[j] = tmp;
  }
  return chars.join("");
}

