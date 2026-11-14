import { Controller, Get, HttpCode, Post, Req, Res, ForbiddenException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import type { Response } from "express";
import { csrfCookieName, sessionCookieName } from "./cookie-names";
import { audienceFrom, issueCsrf } from "./cookies";
import type { CookieAwareRequest } from "./cookies";
import { SessionService } from "./session.service";

/**
 * Customer auth session utilities.
 * - Customer OTP/verification flows removed from active use.
 * - Admin authentication remains in StaffAuthController (unchanged).
 */
@Controller("auth")
export class AuthController {
  constructor(
    private readonly sessions: SessionService,
    private readonly prisma: PrismaClient,
  ) {}

  @Post("logout")
  @HttpCode(204)
  async logout(@Req() req: CookieAwareRequest, @Res({ passthrough: true }) res: Response) {
    const audience = audienceFrom(req);
    const token = (req.cookies as Record<string, string> | undefined)?.[sessionCookieName(audience)];
    if (token) await this.sessions.revoke(token);
    res.clearCookie(sessionCookieName(audience), { path: "/" });
    res.clearCookie(csrfCookieName(audience), { path: "/" });
  }

  @Get("me")
  async me(@Req() req: CookieAwareRequest, @Res({ passthrough: true }) res: Response) {
    const audience = audienceFrom(req);
    const token = (req.cookies as Record<string, string> | undefined)?.[sessionCookieName(audience)];
    if (!token) throw new ForbiddenException("Not authenticated.");
    const user = await this.sessions.resolve(token, audience).catch(() => {
      res.clearCookie(sessionCookieName(audience), { path: "/" });
      res.clearCookie(csrfCookieName(audience), { path: "/" });
      return null;
    });
    if (!user) throw new ForbiddenException("Not authenticated.");

    const csrfToken = issueCsrf(res, audience);

    let profile: {
      fullName: string;
      defaultAddress: null | {
        line1: string;
        line2: string | null;
        city: string;
        state: string;
        lga: string;
        deliveryNote: string | null;
      };
    } | null = null;

    if (user.kind === "customer") {
      const customer = await this.prisma.customerProfile.findUnique({
        where: { userId: user.id },
        include: {
          addresses: {
            where: { deletedAt: null },
            orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
            take: 1,
          },
        },
      });
      if (customer) {
        const addr = customer.addresses[0];
        profile = {
          fullName: customer.fullName,
          defaultAddress: addr
            ? {
                line1: addr.line1,
                line2: addr.line2,
                city: addr.city,
                state: addr.state,
                lga: addr.lga,
                deliveryNote: addr.deliveryNote,
              }
            : null,
        };
      }
    }

    return {
      id: user.id,
      phone: user.phone,
      email: user.email ?? null,
      kind: user.kind,
      emailVerified: Boolean(user.emailVerifiedAt),
      phoneVerified: Boolean(user.phoneVerifiedAt),
      hasPassword: Boolean(user.passwordHash),
      csrfToken,
      profile,
    };
  }

  @Get("csrf")
  async csrf(@Req() req: CookieAwareRequest, @Res({ passthrough: true }) res: Response) {
    const audience = audienceFrom(req);
    const token = (req.cookies as Record<string, string> | undefined)?.[sessionCookieName(audience)];
    if (!token) throw new ForbiddenException("Not authenticated.");
    await this.sessions.resolve(token, audience);
    const csrfToken = issueCsrf(res, audience);
    return { csrfToken };
  }
}
