import { Module, RequestMethod } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { APP_GUARD, NestFactory, Reflector } from "@nestjs/core";
import cookieParser from "cookie-parser";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { AuthGuard } from "../auth/auth.guard";
import { sessionCookieName } from "../auth/cookie-names";
import { browserSecurityMiddleware } from "../common/http";
import { HealthController } from "./health.controller";
import { HEALTH_PRISMA } from "./health.database";
import { healthNoStore } from "./health.middleware";

const healthPrisma = {
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
};

const guardPrisma = {
  user: { findUnique: vi.fn() },
};

const sessions = { resolve: vi.fn() };

type HealthTx = {
  $queryRaw: typeof healthPrisma.$queryRaw;
};

@Module({
  controllers: [HealthController],
  providers: [
    { provide: HEALTH_PRISMA, useValue: healthPrisma },
    {
      provide: APP_GUARD,
      useValue: new AuthGuard(
        new Reflector(),
        sessions as any,
        guardPrisma as any,
      ),
    },
  ],
})
class HealthHttpTestModule {}

describe("GET /health", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(HealthHttpTestModule, { logger: false });
    app.setGlobalPrefix("api/v1", {
      exclude: [{ path: "health", method: RequestMethod.GET }],
    });
    app.use("/health", healthNoStore);
    app.use(cookieParser());
    app.use(browserSecurityMiddleware);
    await app.listen(0, "127.0.0.1");

    const address = app.getHttpServer().address();
    if (!address || typeof address === "string") {
      throw new Error("Test server did not expose a TCP address");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.resetAllMocks();
    healthPrisma.$transaction.mockImplementation(
      async (fn: (tx: HealthTx) => Promise<unknown>) =>
        fn({ $queryRaw: healthPrisma.$queryRaw }),
    );
  });

  it("allows unauthenticated access and returns 200 with no-store", async () => {
    healthPrisma.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);

    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      database: "ok",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(sessions.resolve).not.toHaveBeenCalled();
  });

  it("returns generic 503 with no-store and no internal details", async () => {
    healthPrisma.$queryRaw.mockRejectedValue(
      new Error("connect ECONNREFUSED postgres://user:secret@db"),
    );

    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = await response.json();
    expect(body).toEqual({
      status: "unhealthy",
      database: "unavailable",
    });

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("ECONNREFUSED");
    expect(serialized).not.toContain("postgres://");
  });

  it("does not resolve sessions for cookie-bearing health requests", async () => {
    healthPrisma.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);

    const response = await fetch(`${baseUrl}/health`, {
      headers: {
        Cookie: `${sessionCookieName("customer")}=stale-session`,
      },
    });

    expect(response.status).toBe(200);
    expect(sessions.resolve).not.toHaveBeenCalled();
    expect(guardPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("sets no-store on pre-controller health rejections", async () => {
    const response = await fetch(`${baseUrl}/health`, {
      headers: { Origin: "http://not-allowed.test" },
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(sessions.resolve).not.toHaveBeenCalled();
  });

  it("keeps health outside the versioned API prefix", async () => {
    const response = await fetch(`${baseUrl}/api/v1/health`);
    expect(response.status).toBe(404);
  });
});
