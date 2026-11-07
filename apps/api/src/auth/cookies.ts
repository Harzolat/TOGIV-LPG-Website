import { ForbiddenException } from "@nestjs/common";
import type { Request, Response } from "express";
import { allowedOrigins } from "../common/http";
import { SESSION_COOKIES } from "./auth.guard";
import type { SessionAudience } from "./session.service";

/**
 * Shared cookie/CSRF/origin helpers for auth endpoints (v1.2 §12.4).
 * Used by the customer OTP controller and the staff password+TOTP controller
 * so both audiences get identical cookie semantics:
 * - __Host- prefixed session cookie: HttpOnly, Secure(prod), SameSite=Lax,
 *   Path=/, no Domain (host-only → defeats sibling-subdomain cookie tossing)
 * - Readable double-submit CSRF cookie, 1h TTL
 */

/** Express Request with cookie-parser types (cookies are always present). */
export type CookieAwareRequest = Request;

/** Which audience this request belongs to, based on which cookie is present. */
export function audienceFrom(req: CookieAwareRequest): SessionAudience {
  return req.cookies && SESSION_COOKIES.admin in req.cookies
    ? "admin"
    : "customer";
}

export function setSessionCookie(
  res: Response,
  audience: SessionAudience,
  token: string,
  expires: Date,
): void {
  res.cookie(SESSION_COOKIES[audience], token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export function issueCsrf(res: Response, audience: SessionAudience): string {
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  res.cookie(`__Host-${audience}_csrf`, token, {
    httpOnly: false, // JS must read it for the double-submit header
    secure: process.env.NODE_ENV === "production",
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
