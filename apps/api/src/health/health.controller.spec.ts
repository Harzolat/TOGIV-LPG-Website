import { ServiceUnavailableException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HealthController } from "./health.controller";
import {
  HEALTH_DB_MAX_WAIT_MS,
  HEALTH_DB_STATEMENT_TIMEOUT_MS,
  HEALTH_DB_TIMEOUT_MS,
} from "./health.database";

type HealthTx = {
  $queryRaw: ReturnType<typeof vi.fn>;
};

describe("HealthController.check", () => {
  let queryRaw: ReturnType<typeof vi.fn>;
  let transaction: ReturnType<typeof vi.fn>;
  let controller: HealthController;

  beforeEach(() => {
    queryRaw = vi.fn();
    transaction = vi.fn(
      async (fn: (tx: HealthTx) => Promise<unknown>) =>
        fn({ $queryRaw: queryRaw }),
    );
    controller = new HealthController({
      $transaction: transaction,
    } as any);
  });

  it("returns ok after a successful bounded transaction", async () => {
    queryRaw.mockResolvedValue([{ "?column?": 1 }]);

    await expect(controller.check()).resolves.toEqual({
      status: "ok",
      database: "ok",
    });

    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: HEALTH_DB_MAX_WAIT_MS,
      timeout: HEALTH_DB_TIMEOUT_MS,
    });
    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(queryRaw.mock.calls[0][0].join("")).toContain("set_config");
    expect(queryRaw.mock.calls[0][1]).toBe(
      String(HEALTH_DB_STATEMENT_TIMEOUT_MS),
    );
  });

  it("returns a generic 503 when the transaction rejects", async () => {
    transaction.mockRejectedValueOnce(
      new Error("connect ECONNREFUSED postgres://user:secret@db"),
    );

    await expect(controller.check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("maps a query timeout to the generic 503 without leaking details", async () => {
    queryRaw.mockRejectedValue(
      new Error("Query read timeout: postgres://user:secret@db"),
    );

    try {
      await controller.check();
      throw new Error("expected check to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      const exception = error as ServiceUnavailableException;
      expect(exception.getStatus()).toBe(503);
      expect(exception.getResponse()).toEqual({
        status: "unhealthy",
        database: "unavailable",
      });

      const serialized = JSON.stringify(exception.getResponse());
      expect(serialized).not.toContain("secret");
      expect(serialized).not.toContain("timeout");
      expect(serialized).not.toContain("postgres://");
    }
  });
});
