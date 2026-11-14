import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import type { PoolConfig } from "pg";
import { getDatabaseUrl } from "../database/database-url";

/** Upper bound for acquiring a connection and for the client-side query. */
export const HEALTH_DB_TIMEOUT_MS = 2_500;

/** Server-side cap, set inside the transaction so it stops first. */
export const HEALTH_DB_STATEMENT_TIMEOUT_MS = 2_000;

/** Maximum time Prisma may wait to start the health transaction. */
export const HEALTH_DB_MAX_WAIT_MS = 2_000;

export const HEALTH_PRISMA = Symbol("HEALTH_PRISMA");

/**
 * Dedicated health-check pool configuration.
 *
 * Keeping these limits separate from the main Prisma client ensures the short
 * health timeout cannot affect normal API traffic. `query_timeout` bounds the
 * client side; `connectionTimeoutMillis` bounds pool checkout/connect.
 *
 * Server-side `statement_timeout` is set inside the health transaction in the
 * controller instead of in the startup packet. Poolers such as PgBouncer can
 * reject unsupported startup parameters, and Neon uses PgBouncer.
 */
export function healthDatabaseConfig(
  connectionString: string = getDatabaseUrl(),
): PoolConfig {
  return {
    connectionString,
    max: 2,
    connectionTimeoutMillis: HEALTH_DB_TIMEOUT_MS,
    query_timeout: HEALTH_DB_TIMEOUT_MS,
  };
}

export function createHealthPrismaClient(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg(healthDatabaseConfig()),
  });
}
