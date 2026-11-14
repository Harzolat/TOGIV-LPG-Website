import { ForbiddenException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGuard, RequirePermission } from "./auth.guard";
import { Public } from "./public.decorator";

@Public()
class PublicTestController {
  handler() {}
}

class ProtectedTestController {
  @RequirePermission("staff:manage")
  handler() {}
}

function context(
  controller: object,
  handler: () => void,
  request: Record<string, unknown>,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe("AuthGuard public routes", () => {
  let sessions: { resolve: ReturnType<typeof vi.fn> };
  let prisma: { user: { findUnique: ReturnType<typeof vi.fn> } };
  let guard: AuthGuard;

  beforeEach(() => {
    sessions = { resolve: vi.fn() };
    prisma = { user: { findUnique: vi.fn() } };
    guard = new AuthGuard(new Reflector(), sessions as any, prisma as any);
  });

  it("bypasses session resolution for @Public even when cookies are present", async () => {
    const request = { cookies: { app_sid: "stale-session" } };

    await expect(
      guard.canActivate(
        context(
          PublicTestController,
          PublicTestController.prototype.handler,
          request,
        ),
      ),
    ).resolves.toBe(true);

    expect(sessions.resolve).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("does not change the protected-route behavior", async () => {
    await expect(
      guard.canActivate(
        context(
          ProtectedTestController,
          ProtectedTestController.prototype.handler,
          { cookies: {} },
        ),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
