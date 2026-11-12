import { ForbiddenException } from "@nestjs/common";
import type { Request, Response } from "express";
import { allowedOrigins } from "../common/http";
import {
  csrfCookieName,
  declaredAudience,
  secureCookies,
  sessionAudienceFromCookies,
  sessionCookieName,
} from "./cookie-names";
import type { SessionAudience } from "./session.service";

/**
 * Shared cookie/CSRF/origin helpers for auth endpoints (v1.2 §12.4).
 * Used by the customer OTP controller and the staff password+TOTP controller
 * so both audiences get identical cookie semantics:
 * - hardened session cookie (`__Host-` in production only, see cookie-names):
 *   HttpOnly, SameSite=Lax, Path=/, no Domain (host-only → defeats sibling
 *   subdomain cookie tossing)
 * - Readable double-submit CSRF cookie, 1h TTL
 */

/** Express Request with cookie-parser types (cookies are always present). */
export type CookieAwareRequest = Request;

/**
 * Which audience this request belongs to.
 *
 * The Origin header is the authority — the two apps are served from different
 * origins, so it never lies about which console called us. Only when Origin
 * is absent (non-browser clients, same-origin GETs) do we fall back to the
 * session cookie that happens to be present; deriving it from cookies while
 * an admin session exists in the browser would mint customer CSRF tokens
 * under the admin name and break the customer flow.
 */
export function audienceFrom(req: CookieAwareRequest): SessionAudience {
  // The calling SPA declares its audience; see declaredAudience() for why
  // Origin + cookie sniffing alone is ambiguous on localhost.
  const declared = declaredAudience(req.headers);
  if (declared) return declared;

  const origin = req.headers.origin;
  if (origin) {
    const [web, admin] = allowedOrigins();
    if (origin === admin) return "admin";
    if (origin === web) return "customer";
  }
  return (
    sessionAudienceFromCookies(req.cookies as Record<string, string | undefined> | undefined) ??
    "customer"
  );
}

export function setSessionCookie(
  res: Response,
  audience: SessionAudience,
  token: string,
  expires: Date,
): void {
  res.cookie(sessionCookieName(audience), token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export function issueCsrf(res: Response, audience: SessionAudience): string {
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  res.cookie(csrfCookieName(audience), token, {
    httpOnly: false, // JS must read it for the double-submit header
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 1000,
  });
  return token;
}

export function assertOrigin(req: Request): void {
  const origin = req.headers.origin;
  if (!origin) return; // non-browser clients (tests) — Origin absent
  if (!allowedOrigins().includes(origin)) {
    throw new ForbiddenException("Origin not allowed.");
  }
}
