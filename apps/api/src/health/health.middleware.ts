import type { NextFunction, Request, Response } from "express";

/** Health status must never be served from a cache. */
export function healthNoStore(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader("Cache-Control", "no-store");
  next();
}
