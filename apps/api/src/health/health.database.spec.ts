import { describe, expect, it } from "vitest";
import { HEALTH_DB_TIMEOUT_MS, healthDatabaseConfig } from "./health.database";

describe("healthDatabaseConfig", () => {
  it("bounds connection acquisition and client-side query time", () => {
    const config = healthDatabaseConfig("postgresql://example.test/togiv");

    expect(config.connectionString).toBe("postgresql://example.test/togiv");
    expect(config.connectionTimeoutMillis).toBe(HEALTH_DB_TIMEOUT_MS);
    expect(config.query_timeout).toBe(HEALTH_DB_TIMEOUT_MS);
    expect(config.max).toBe(2);
    expect(HEALTH_DB_TIMEOUT_MS).toBeGreaterThan(0);
    expect(HEALTH_DB_TIMEOUT_MS).toBeLessThanOrEqual(5_000);

    // Set per transaction in the controller. Sending it in the startup packet
    // can be rejected by PgBouncer/Neon.
    expect(config.statement_timeout).toBeUndefined();
  });
});
