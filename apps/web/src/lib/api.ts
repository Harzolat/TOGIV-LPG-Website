/**
 * Typed API client for the customer app.
 * - Same-origin `/api/v1` via Vite proxy (credentials included)
 * - Double-submit CSRF: reads the `customer_csrf` cookie set by the auth
 *   endpoints and echoes it in `x-csrf-token` on mutations (v1.2 §12.4).
 *   Production names the cookie `__Host-customer_csrf`, so both spellings
 *   are accepted here.
 * - Normalises error bodies to `ApiError(status, message)`
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const CSRF_COOKIE = "customer_csrf";

/** Look up a cookie by name, ignoring the `__Host-` prefix the API adds in
 *  production (browsers only accept that prefix over https). */
function readCookie(name: string): string | undefined {
  for (const part of document.cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name || key === `__Host-${name}`) {
      return decodeURIComponent(value.join("="));
    }
  }
  return undefined;
}

/** Readable CSRF cookie (double-submit) — auth endpoints also require it
 *  as a body field on OTP verification (v1.2 §12.4). */
export function getCsrfToken(): string | undefined {
  return readCookie(CSRF_COOKIE);
}

interface ApiOptions extends Omit<RequestInit, "headers" | "body"> {
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * Public entry point. A 403 "CSRF validation failed" means the readable
 * cookie lapsed while the session stayed valid (its TTL is shorter): mint a
 * fresh pair from /auth/csrf and replay the call exactly once.
 */
export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  try {
    return await send<T>(path, options);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403 && /csrf/i.test(e.message)) {
      await send("/auth/csrf");
      return await send<T>(path, options);
    }
    throw e;
  }
}

async function send<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = {
    Accept: "application/json",
    // Declares which cookie pair this SPA owns (same-origin GETs send no
    // Origin, and localhost shares cookies across ports).
    "x-togi-audience": "customer",
    ...options.headers,
  };

  let body: string | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  if (method !== "GET" && method !== "HEAD") {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) headers["x-csrf-token"] = csrf;
  }

  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { ...options, method, headers, body, credentials: "include" });
  } catch {
    throw new ApiError(0, "Network error — check your connection and try again.");
  }

  if (res.status === 204) return undefined as T;

  const payload = (await res.json().catch(() => null)) as
    | { message?: string; details?: string }
    | null;

  if (!res.ok) {
    throw new ApiError(
      res.status,
      payload?.message ?? "Something went wrong. Please try again.",
      payload?.details,
    );
  }
  return payload as T;
}
