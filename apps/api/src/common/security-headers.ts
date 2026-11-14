import type { NextFunction, Request, Response } from "express";

/**
 * Baseline security headers for every API response.
 *
 * The API only ever returns JSON, so a locked-down CSP is safe and
 * meaningful (it also stops an error page from ever being framed). HSTS is
 * production-only: sending it over plain-HTTP localhost is ignored by
 * browsers but would be misleading in logs.
 *
 * The two SPAs are static bundles — their production host must send the
 * equivalent headers (see apps/web/public/_headers and
 * apps/admin/public/_headers).
 */
export function securityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Express advertises itself by default; strip it on every response.
  res.removeHeader("X-Powered-By");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  );
  if (process.env.NODE_ENV === "production") {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }
  next();
}
