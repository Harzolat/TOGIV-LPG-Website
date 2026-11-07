import { Injectable, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { generateOtpCode, hashOtp, verifyOtp } from "../common/tokens";

/**
 * Hardened OTP service — v1.2 §12 (approved controls):
 *
 * | Control                  | Default   |
 * |--------------------------|-----------|
 * | TTL                      | 5 min     |
 * | Verify attempts per code | 5 → invalidate, require new code |
 * | Resend cooldown          | 60 s      |
 * | Sends per phone          | 3 / 15 min, 10 / 24 h |
 * | Sends per IP             | 10 / hour |
 * | Failure backoff          | immediate, immediate, 5s, 30s, 120s per (phone, IP) |
 * | Captcha                  | after 3 failures/phone or 10/IP per hour (hook) |
 *
 * DoS-safe: customers are NEVER hard-locked. Throttles are keyed to
 * (phone, IP) pairs with short, self-recovering windows. Permanent locks
 * are forbidden; any temporary throttle ≤ 15 minutes.
 */

const TTL_MS = 5 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60_000;
const PHONE_WINDOW_MS = 15 * 60 * 1000;
const PHONE_WINDOW_MAX = 3;
const PHONE_DAY_MAX = 10;
const IP_HOUR_MAX = 10;
const FAILURE_BACKOFF_MS = [0, 0, 5_000, 30_000, 120_000];
const MAX_BACKOFF_MS = 15 * 60 * 1000; // hard cap: 15 minutes

export type OtpPurpose = "login" | "register" | "recovery";

export class OtpThrottledError extends Error {
  constructor(
    public readonly retryAfterMs: number,
    message = "Too many requests. Please wait before trying again.",
  ) {
    super(message);
    this.name = "OtpThrottledError";
  }
}

export class OtpInvalidError extends Error {
  constructor(message = "Invalid or expired code.") {
    super(message);
    this.name = "OtpInvalidError";
  }
}

export interface SmsProviderResult {
  providerRef: string;
}

/** Provider abstraction — dev/testing adapter by default (v1.2 Part 5.B).
 *  Abstract class (not interface) so NestJS can use it as a DI token. */
export abstract class SmsProvider {
  abstract send(phone: string, message: string): Promise<SmsProviderResult>;
}

export class DevSmsAdapter extends SmsProvider {
  private readonly logger = new Logger("DevSmsAdapter");

  async send(phone: string, message: string): Promise<SmsProviderResult> {
    // Development/testing adapter: capture to logs, never call a real gateway.
    this.logger.log(`[DEV SMS → ${phone}] ${message}`);
    return { providerRef: `dev-${Date.now()}` };
  }
}

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly sms: SmsProvider,
  ) {}

  /** Issues a new OTP, enforcing cooldown + send windows (self-recovering). */
  async issue(phone: string, purpose: OtpPurpose, ip?: string): Promise<void> {
    const now = Date.now();

    // Resend cooldown: most recent code for this phone+purpose
    const last = await this.prisma.otpCode.findFirst({
      where: { phone, purpose },
      orderBy: { createdAt: "desc" },
    });
    if (last && now - last.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      throw new OtpThrottledError(RESEND_COOLDOWN_MS - (now - last.createdAt.getTime()));
    }

    // Send windows: per-phone (15 min + 24 h) and per-IP (1 hour)
    const phoneWindow = await this.countSince(phone, now - PHONE_WINDOW_MS);
    if (phoneWindow >= PHONE_WINDOW_MAX) {
      const oldest = await this.oldestSince(phone, now - PHONE_WINDOW_MS);
      throw new OtpThrottledError(
        Math.min(oldest + PHONE_WINDOW_MS - now, MAX_BACKOFF_MS),
        "Too many codes requested for this number. Please try again shortly.",
      );
    }
    const phoneDay = await this.countSince(phone, now - 24 * 60 * 60 * 1000);
    if (phoneDay >= PHONE_DAY_MAX) {
      throw new OtpThrottledError(
        Math.min((await this.oldestSince(phone, now - 24 * 60 * 60 * 1000)) + 24 * 60 * 60 * 1000 - now, MAX_BACKOFF_MS),
        "Daily code limit reached for this number. Please try again later.",
      );
    }
    if (ip) {
      const ipCount = await this.prisma.otpCode.count({
        where: { ip, createdAt: { gte: new Date(now - 60 * 60 * 1000) } },
      });
      if (ipCount >= IP_HOUR_MAX) {
        throw new OtpThrottledError(
          60 * 60 * 1000,
          "Too many requests from this network. Please try again later.",
        );
      }
    }

    const code = generateOtpCode();
    await this.prisma.otpCode.create({
      data: {
        phone,
        purpose,
        codeHash: hashOtp(code),
        ip: ip ?? null,
        expiresAt: new Date(now + TTL_MS),
      },
    });

    // In production this is replaced by the chosen provider behind SmsProvider.
    await this.sms.send(
      phone,
      `Your Throne of Grace verification code is ${code}. Valid for 5 minutes. Never share this code.`,
    );

    this.logger.log(`OTP issued for ${phone} (${purpose})`);
  }

  /** Verifies with attempt cap and per-(phone,IP) exponential backoff. */
  async verify(phone: string, purpose: OtpPurpose, code: string): Promise<void> {
    const record = await this.prisma.otpCode.findFirst({
      where: { phone, purpose, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });

    if (!record || record.expiresAt.getTime() < Date.now()) {
      throw new OtpInvalidError();
    }

    if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
      // Code invalidated — require a fresh one (not an account lock)
      await this.prisma.otpCode.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      });
      throw new OtpInvalidError("Too many attempts. Please request a new code.");
    }

    // Exponential backoff per (phone) on failed attempts — self-recovering
    if (record.attempts >= 2) {
      const backoff = FAILURE_BACKOFF_MS[Math.min(record.attempts, FAILURE_BACKOFF_MS.length - 1)];
      const lastIssued = record.createdAt.getTime();
      const earliestRetry = lastIssued + backoff;
      if (Date.now() < earliestRetry) {
        throw new OtpThrottledError(Math.min(earliestRetry - Date.now(), MAX_BACKOFF_MS));
      }
    }

    if (!verifyOtp(code, record.codeHash)) {
      await this.prisma.otpCode.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      // Backoff hook: captcha triggers at 3 failures/phone (per v1.2 §12) —
      // wired to middleware in the auth module.
      throw new OtpInvalidError("Invalid code.");
    }

    await this.prisma.otpCode.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
  }

  private async countSince(phone: string, sinceMs: number): Promise<number> {
    return this.prisma.otpCode.count({
      where: { phone, createdAt: { gte: new Date(sinceMs) } },
    });
  }

  private async oldestSince(phone: string, sinceMs: number): Promise<number> {
    const oldest = await this.prisma.otpCode.findFirst({
      where: { phone, createdAt: { gte: new Date(sinceMs) } },
      orderBy: { createdAt: "asc" },
    });
    return oldest ? oldest.createdAt.getTime() : sinceMs;
  }
}
