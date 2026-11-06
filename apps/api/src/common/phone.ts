import { parsePhoneNumberFromString } from "libphonenumber-js";

/**
 * Nigerian phone normalisation (v1.2 §12, approved).
 * Accepts 0803…, 803…, +234…, 234… → stores E.164 (+234…).
 * Rejects malformed / non-NG numbers with a field-level error.
 */
export class PhoneNormalizationError extends Error {
  constructor(public readonly input: string) {
    super(`Invalid Nigerian phone number: ${input}`);
    this.name = "PhoneNormalizationError";
  }
}

export function normalizeNgPhone(raw: string): string {
  const trimmed = raw.trim().replace(/[\s\-().]/g, "");
  const parsed = parsePhoneNumberFromString(trimmed, "NG");
  if (!parsed || !parsed.isValid() || parsed.country !== "NG") {
    throw new PhoneNormalizationError(raw);
  }
  return parsed.number; // E.164, e.g. +2348012345678
}

export function isValidNgPhone(raw: string): boolean {
  try {
    normalizeNgPhone(raw);
    return true;
  } catch {
    return false;
  }
}
