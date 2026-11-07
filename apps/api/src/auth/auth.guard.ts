import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { SessionService, SessionAudience } from "./session.service";
import { User } from "@prisma/client";

/**
 * RBAC + resource-scoped authorization — v1.2 §1.3 (approved matrix).
 *
 * - Every protected route declares @RequirePermission('resource:action')
 * - Server-side enforcement: UI hiding is never the control
 * - Audience guard: admin routes reject customer sessions and vice versa
 * - Session resolved from __Host- cookie value passed by the HTTP layer
 * - Resource-level scoping (ownership) is enforced in services, not here
 */

export const PERMISSION_KEY = "required_permission";
export const AUDIENCE_KEY = "required_audience";

export const RequirePermission = (permission: string) =>
  SetMetadata(PERMISSION_KEY, permission);

export const RequireAudience = (audience: SessionAudience) =>
  SetMetadata(AUDIENCE_KEY, audience);

/** Cookie names — distinct per origin, __Host- prefix (v1.2 §12.4) */
export const SESSION_COOKIES: Record<SessionAudience, string> = {
  customer: "__Host-app_sid",
  admin: "__Host-admin_sid",
};

interface AuthenticatedRequest extends Request {
  cookies?: Record<string, string>;
  user?: User;
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

    // Public routes: no metadata → open (still validated at service layer)
    if (!permission && !audience) return true;

    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookieName = audience ? SESSION_COOKIES[audience] : null;
    const token = cookieName
      ? request.cookies?.[cookieName]
      : (request.cookies?.[SESSION_COOKIES.customer] ??
        request.cookies?.[SESSION_COOKIES.admin]);

    if (!token) throw new ForbiddenException("Authentication required.");

    // Audience-bound resolution: mismatched-origin sessions rejected (§12.4)
    const effectiveAudience: SessionAudience =
      audience ?? (token === request.cookies?.[SESSION_COOKIES.admin] ? "admin" : "customer");
    const user = await this.sessions.resolve(token, effectiveAudience);
    request.user = user;
    request.sessionToken = token;

    if (permission) {
      const allowed = await this.hasPermission(user.id, permission);
      if (!allowed) {
        throw new ForbiddenException(`Missing permission: ${permission}`);
      }
    }

    return true;
  }

  /** Role → permission lookup (roles M:N, seeded). Cached in-process later. */
  async hasPermission(userId: string, permission: string): Promise<boolean> {
    const roles = await this.prisma.user.findUnique({
      where: { id: userId },
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
    if (!roles) return false;
    return roles.roles.some((ur) =>
      ur.role.permissions.some((rp) => rp.permission.key === permission),
    );
  }
}
