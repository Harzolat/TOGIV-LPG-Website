/**
 * VAPID configuration for Web Push.
 *
 * Keys are read from environment variables and never exposed to frontends
 * (only the public key is served via authenticated/config endpoint if needed).
 */
export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string; // mailto: or https: URL
}

let cached: VapidConfig | null | undefined;

function readEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

export function getVapidConfig(): VapidConfig | null {
  if (cached !== undefined) return cached;
  const publicKey = readEnv("VAPID_PUBLIC_KEY");
  const privateKey = readEnv("VAPID_PRIVATE_KEY");
  const subject = readEnv("VAPID_SUBJECT") ?? "mailto:admin@throneofgrace.local";
  if (!publicKey || !privateKey) {
    cached = null;
    return null;
  }
  cached = { publicKey, privateKey, subject };
  return cached;
}

export function requireVapidConfig(): VapidConfig {
  const cfg = getVapidConfig();
  if (!cfg) {
    throw new Error(
      "Web Push is not configured (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY missing).",
    );
  }
  return cfg;
}

/** Safe for clients: public key only. */
export function getPublicVapidKey(): string | null {
  return getVapidConfig()?.publicKey ?? null;
}
