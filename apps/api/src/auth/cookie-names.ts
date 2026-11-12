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

/** Whichever audience currently holds a session cookie (customer wins ties,
 *  matching the guard's cookie preference for dual-audience routes). */
export function sessionAudienceFromCookies(
  cookies: Record<string, string | undefined> | undefined,
): SessionAudience | null {
  if (!cookies) return null;
  if (cookies[sessionCookieName("customer")]) return "customer";
  if (cookies[sessionCookieName("admin")]) return "admin";
  return null;
}

/**
 * The audience the calling SPA declares via `x-togi-audience`.
 *
 * Needed because same-origin GETs carry no `Origin` header and localhost
 * shares cookies across ports: without an explicit declaration, a signed-in
 * admin console would make the customer app read the admin session. The
 * value only selects which cookie name to read — it grants no authority on
 * its own, so a forged value can at most make the caller anonymous.
 */
export function declaredAudience(
  headers: Record<string, string | string[] | undefined> | undefined,
): SessionAudience | null {
  const raw = headers?.["x-togi-audience"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "admin" || value === "customer" ? value : null;
}
