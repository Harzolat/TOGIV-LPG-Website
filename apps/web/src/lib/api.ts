/**
 * Typed API client for the customer app.
 * - Same-origin `/api/v1` via Vite proxy (credentials included)
 * - Double-submit CSRF: reads the `__Host-customer_csrf` cookie set by the
 *   auth endpoints and echoes it in `x-csrf-token` on mutations (v1.2 §12.4)
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

function readCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

/** Readable CSRF cookie (double-submit) — auth endpoints also require it
 *  as a body field on OTP verification (v1.2 §12.4). */
export function getCsrfToken(): string | undefined {
  return readCookie("__Host-customer_csrf");
}

interface ApiOptions extends Omit<RequestInit, "headers" | "body"> {
  body?: unknown;
  headers?: Record<string, string>;
}

export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = { Accept: "application/json", ...options.headers };

  let body: string | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  if (method !== "GET" && method !== "HEAD") {
    const csrf = readCookie("__Host-customer_csrf");
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
