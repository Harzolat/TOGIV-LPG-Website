const DEFAULT_DATABASE_URL =
  "postgresql://user:password@localhost:5432/togiv_lpg?schema=public";

/** Runtime database URL. Read lazily so env loading happens before first use. */
export function getDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}
