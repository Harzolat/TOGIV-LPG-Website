import { ForbiddenException } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import {
  csrfCookieName,
  declaredAudience,
  sessionAudienceFromCookies,
  sessionCookieName,
} from "../auth/cookie-names";
import type { SessionAudience } from "../auth/session.service";

/**
 * Browser request hygiene middleware (v1.2 §12.4) — runs before guards:
 *
 * 1. Origin allowlist: any request carrying an Origin header must match the
 *    customer or admin origin. No reflection, never '*'.
 * 2. Double-submit CSRF: state-changing methods (POST/PUT/PATCH/DELETE) that
 *    carry a session cookie must present the matching `x-csrf-token` header
 *    equal to the readable `<audience>_csrf` cookie. Requests without
 *    a session cookie (guest submissions, OTP endpoints) pass — they are
 *    Origin-checked and hold no ambient authority.
 */

const CSRF_HEADER = "x-csrf-token";
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Customer origin first, admin origin second. Defaults match the Vite
 *  configs in apps/web and apps/admin so a checkout without .env still works. */
export function allowedOrigins(): string[] {
  return [
    process.env.WEB_ORIGIN ?? "http://localhost:5175",
    process.env.ADMIN_ORIGIN ?? "http://localhost:5176",
  ];
}

export function browserSecurityMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (origin && !allowedOrigins().includes(origin)) {
    next(new ForbiddenException("Origin not allowed."));
    return;
  }

  if (MUTATING.has(req.method)) {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies ?? {};
    // Audience follows the page that issued the request (Origin), not the
    // cookie jar: cookies are shared across ports on localhost, so a signed-in
    // admin console would otherwise make the middleware demand the *admin*
    // CSRF token from the customer app (and vice versa) — a permanent
    // mismatch, because each app only ever sends its own audience's token.
    const [web, admin] = allowedOrigins();
    const audience: SessionAudience =
      declaredAudience(req.headers as Record<string, string | string[] | undefined>) ??
      (origin === admin
        ? "admin"
        : origin === web
          ? "customer"
          : (sessionAudienceFromCookies(cookies) ?? "customer"));

    // Only enforce when this audience actually holds a session; guests and
    // the other audience's cookies carry no ambient authority here.
    if (cookies[sessionCookieName(audience)]) {
      const csrfCookie = cookies[csrfCookieName(audience)];
      const csrfHeader = req.headers[CSRF_HEADER];
      const headerValue = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;
      // A session cookie without a readable CSRF cookie means the pair was
      // broken (e.g. a cookie rejected by the browser): treat it as no
      // session rather than silently accepting an unprotected mutation.
      if (!csrfCookie || !headerValue || csrfCookie !== headerValue) {
        next(new ForbiddenException("CSRF validation failed."));
        return;
      }
    }
  }

  next();
}
