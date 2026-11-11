import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PrismaClient, User } from "@prisma/client";
import { SessionService, SessionAudience } from "./session.service";
import { sessionCookieName } from "./cookie-names";

/**
 * RBAC + resource-scoped authorization — v1.2 §1.3 (approved matrix).
 *
 * - Every protected route declares @RequirePermission('resource:action')
 * - Server-side enforcement: UI hiding is never the control
 * - Audience guard: admin routes reject customer sessions and vice versa
 * - One query resolves roles AND permissions; role keys are attached to the
 *   request so controllers can branch (e.g. claim decision auditing)
 * - Resource-level scoping (ownership) is enforced in services/controllers
 */

export const PERMISSION_KEY = "required_permission";
export const AUDIENCE_KEY = "required_audience";

export const RequirePermission = (permission: string) =>
  SetMetadata(PERMISSION_KEY, permission);

export const RequireAudience = (audience: SessionAudience) =>
  SetMetadata(AUDIENCE_KEY, audience);

export interface AuthedRequest extends Request {
  user?: User;
  userRoles?: string[];
  sessionToken?: string;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaClient,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.getAllAndOverride<string | undefined>(
      PERMISSION_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    const audience = this.reflector.getAllAndOverride<SessionAudience | undefined>(
      AUDIENCE_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );

    const request = ctx.switchToHttp().getRequest<
      AuthedRequest & { cookies?: Record<string, string> }
    >();

    // Cookie selection: metadata pins the audience; otherwise prefer the
    // customer cookie, falling back to admin (dual-audience detail routes).
    const customerCookie = sessionCookieName("customer");
    const adminCookie = sessionCookieName("admin");
    const cookieName = audience
      ? sessionCookieName(audience)
      : request.cookies?.[customerCookie]
        ? customerCookie
        : adminCookie;
    const token = request.cookies?.[cookieName];

    if (!token) {
      if (permission || audience) {
        throw new ForbiddenException("Authentication required.");
      }
      return true; // public route with no session
    }

    const effectiveAudience: SessionAudience =
      cookieName === adminCookie ? "admin" : "customer";

    // Metadata routes: invalid/expired session is a hard 401.
    // Optional routes (no metadata): stale cookie degrades to anonymous.
    let user: User;
    try {
      user = await this.sessions.resolve(token, effectiveAudience);
    } catch (e) {
      if (permission || audience) throw e;
      return true;
    }
    request.user = user;
    request.sessionToken = token;

    // One query: roles + permissions (permission check needs the expansion)
    const withRoles = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: {
        roles: {
          include: {
            role: {
              include: {
                permissions: { include: { permission: true } },
              },
            },
          },
        },
      },
    });
    request.userRoles = withRoles?.roles.map((ur) => ur.role.key) ?? [];

    if (permission) {
      const allowed = withRoles?.roles.some((ur) =>
        ur.role.permissions.some((rp) => rp.permission.key === permission),
      );
      if (!allowed) {
        throw new ForbiddenException(`Missing permission: ${permission}`);
      }
    }

    return true;
  }
}
