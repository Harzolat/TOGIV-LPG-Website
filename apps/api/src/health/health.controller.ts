import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { Public } from "../auth/public.decorator";
import {
  HEALTH_DB_MAX_WAIT_MS,
  HEALTH_DB_STATEMENT_TIMEOUT_MS,
  HEALTH_DB_TIMEOUT_MS,
  HEALTH_PRISMA,
} from "./health.database";

/**
 * Production liveness/readiness probe.
 *
 * Kept free of customer/admin data and internal error details. A failed
 * database query returns a generic 503 so infrastructure information never
 * leaks through the endpoint.
 *
 * The dedicated health client bounds connection acquisition and client-side
 * query reads. The transaction additionally sets a server-side
 * `statement_timeout`, so a timed-out query is stopped by PostgreSQL too.
 */
@Controller("health")
@Public()
export class HealthController {
  constructor(
    @Inject(HEALTH_PRISMA) private readonly prisma: PrismaClient,
  ) {}

  @Get()
  async check() {
    try {
      await this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(
            HEALTH_DB_STATEMENT_TIMEOUT_MS,
          )}, true)`;
          await tx.$queryRaw`SELECT 1`;
        },
        {
          maxWait: HEALTH_DB_MAX_WAIT_MS,
          timeout: HEALTH_DB_TIMEOUT_MS,
        },
      );
      return { status: "ok", database: "ok" };
    } catch {
      throw new ServiceUnavailableException({
        status: "unhealthy",
        database: "unavailable",
      });
    }
  }
}
