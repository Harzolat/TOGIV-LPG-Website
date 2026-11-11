import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PrismaClient, User } from "@prisma/client";
import { generateOpaqueToken, hashToken } from "../common/tokens";

/**
 * Session service — v1.2 §12 / §12.4 (approved):
 * - Opaque 256-bit token, stored SHA-256 hashed, raw never persisted
 * - `audience: customer | admin` — a session minted for one audience is
 *   rejected on the other origin's routes (cross-origin isolation)
 * - Idle/absolute TTLs: customer 7d idle / 30d absolute; staff 12h idle
 * - Cookie is set by the HTTP layer: __Host- prefix, Secure, HttpOnly,
 *   SameSite=Lax, Path=/, NO Domain attribute
 * - Explicit server-side revocation ("log out all devices")
 */

const AUDIENCE = {
  customer: { idleMs: 7 * 24 * 60 * 60 * 1000, absoluteMs: 30 * 24 * 60 * 60 * 1000 },
  admin: { idleMs: 12 * 60 * 60 * 1000, absoluteMs: 12 * 60 * 60 * 1000 },
} as const;

export type SessionAudience = keyof typeof AUDIENCE;

export interface IssuedSession {
  /** Raw token — returned once, set as cookie, never stored server-side */
  token: string;
  expiresAt: Date;
}

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaClient) {}

  async issue(
    userId: string,
    audience: SessionAudience,
    meta: { ip?: string; userAgent?: string } = {},
  ): Promise<IssuedSession> {
    const token = generateOpaqueToken(32);
    const ttl = AUDIENCE[audience];
    const now = Date.now();
    const expiresAt = new Date(now + ttl.absoluteMs);

    await this.prisma.session.create({
      data: {
        tokenHash: hashToken(token),
        userId,
        audience,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
        expiresAt,
      },
    });

    return { token, expiresAt };
  }

  /**
   * Validates a raw token: existence, audience, expiry, revocation.
   * Returns the user or throws UnauthorizedException.
   */
  async resolve(token: string, audience: SessionAudience): Promise<User> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });

    if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException("Invalid or expired session.");
    }
    if (session.audience !== audience) {
      // Cross-origin/cross-audience replay rejected (v1.2 §12.4)
      throw new UnauthorizedException("Session audience mismatch.");
    }
    if (session.user.status !== "active" || session.user.deletedAt) {
      throw new UnauthorizedException("Account is not active.");
    }

    // Sliding idle window, capped by an absolute lifetime measured from issue
    // time. (Previously this clamped against the *previous* expiresAt, which
    // ratcheted the session down to the idle window and logged active
    // customers out after 7 days instead of 30.)
    const idle = AUDIENCE[audience].idleMs;
    const absoluteCap = session.createdAt.getTime() + AUDIENCE[audience].absoluteMs;
    const slidExpiry = Math.min(Date.now() + idle, absoluteCap);
    if (slidExpiry > session.expiresAt.getTime()) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { expiresAt: new Date(slidExpiry) },
      });
    }

    return session.user;
  }

  async revoke(token: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
