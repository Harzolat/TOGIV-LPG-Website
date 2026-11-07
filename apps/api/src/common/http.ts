import { ForbiddenException } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { SESSION_COOKIES } from "../auth/auth.guard";

/**
 * Browser request hygiene middleware (v1.2 §12.4) — runs before guards:
 *
 * 1. Origin allowlist: any request carrying an Origin header must match the
 *    customer or admin origin. No reflection, never '*'.
 * 2. Double-submit CSRF: state-changing methods (POST/PUT/PATCH/DELETE) that
 *    carry a session cookie must present the matching `x-csrf-token` header
 *    equal to the readable `__Host-<audience>_csrf` cookie. Requests without
 *    a session cookie (guest submissions, OTP endpoints) pass — they are
 *    Origin-checked and hold no ambient authority.
 */

const CSRF_HEADER = "x-csrf-token";
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function allowedOrigins(): string[] {
  return [
    process.env.WEB_ORIGIN ?? "http://localhost:5173",
    process.env.ADMIN_ORIGIN ?? "http://localhost:5174",
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
    const sessionCookie: string | null = cookies[SESSION_COOKIES.admin]
      ? SESSION_COOKIES.admin
      : cookies[SESSION_COOKIES.customer]
        ? SESSION_COOKIES.customer
        : null;

    if (sessionCookie) {
      const audience = sessionCookie === SESSION_COOKIES.admin ? "admin" : "customer";
      const csrfCookie = cookies[`__Host-${audience}_csrf`];
      const csrfHeader = req.headers[CSRF_HEADER];
      const headerValue = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;
      if (!csrfCookie || !headerValue || csrfCookie !== headerValue) {
        next(new ForbiddenException("CSRF validation failed."));
        return;
      }
    }
  }

  next();
}
