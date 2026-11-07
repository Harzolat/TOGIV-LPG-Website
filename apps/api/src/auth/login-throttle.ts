import { Injectable } from "@nestjs/common";

/**
 * In-memory login throttle for staff password login (v1.2 §12 throttling).
 *
 * Progressive lockout per (ip|identifier) key:
 *   3 fails → 15s, 5 fails → 5min, 10+ fails → 30min
 * Resets on success. Single-instance by design; a multi-instance deployment
 * must move this to shared storage (documented alongside the OTP throttle).
 */

const LOCKS: Array<{ fails: number; lockMs: number }> = [
  { fails: 10, lockMs: 30 * 60_000 },
  { fails: 5, lockMs: 5 * 60_000 },
  { fails: 3, lockMs: 15_000 },
];

interface Entry {
  fails: number;
  lockedUntil: number;
}

@Injectable()
export class LoginThrottle {
  private readonly entries = new Map<string, Entry>();

  /** Milliseconds the caller must wait (0 = allowed now). */
  retryAfterMs(key: string): number {
    const e = this.entries.get(key);
    if (!e) return 0;
    return Math.max(0, e.lockedUntil - Date.now());
  }

  fail(key: string): void {
    const e = this.entries.get(key) ?? { fails: 0, lockedUntil: 0 };
    e.fails += 1;
    const rule = LOCKS.find((r) => e.fails >= r.fails);
    if (rule) e.lockedUntil = Date.now() + rule.lockMs;
    this.entries.set(key, e);
    // Bound memory: prune long-dead entries opportunistically
    if (this.entries.size > 10_000) {
      const now = Date.now();
      for (const [k, v] of this.entries) {
        if (v.lockedUntil < now && v.fails < 3) this.entries.delete(k);
      }
    }
  }

  reset(key: string): void {
    this.entries.delete(key);
  }
}
