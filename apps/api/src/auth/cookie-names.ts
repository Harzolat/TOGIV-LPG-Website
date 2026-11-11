import type { SessionAudience } from "./session.service";

/**
 * Cookie naming — v1.2 §12.4, single source of truth.
 *
 * Production keeps the hardened `__Host-` prefix (host-only, Secure, Path=/).
 * Browsers *reject* `__Host-` cookies that are not Secure, and they drop
 * Secure cookies over plain http://localhost — so local development
 * (NODE_ENV !== "production") uses the same names without the prefix.
 * Isolation is unchanged either way: one session cookie and one CSRF cookie
 * per audience.
 *
 * Read the flag per call, not at module load: `main.ts` loads `.env` after
 * its imports are evaluated, so a module-level constant would miss it.
 */

export function secureCookies(): boolean {
  return process.env.NODE_ENV === "production";
}

function prefix(): string {
  return secureCookies() ? "__Host-" : "";
}

export function sessionCookieName(audience: SessionAudience): string {
  return `${prefix()}${audience === "admin" ? "admin_sid" : "app_sid"}`;
}

export function csrfCookieName(audience: SessionAudience): string {
  return `${prefix()}${audience}_csrf`;
}

/** Whichever audience currently holds a session cookie (admin wins ties). */
export function sessionAudienceFromCookies(
  cookies: Record<string, string | undefined> | undefined,
): SessionAudience | null {
  if (!cookies) return null;
  if (cookies[sessionCookieName("admin")]) return "admin";
  if (cookies[sessionCookieName("customer")]) return "customer";
  return null;
}
