import { Injectable } from "@nestjs/common";

/**
 * Fixed-window quota for public recovery endpoints.
 *
 * Distinct from LoginThrottle (progressive lockout for credential guessing):
 * this is a simple per-IP request quota that keeps the recovery guidance and
 * token endpoints from being used as a free enumeration/spam channel. It also
 * caps the CPU cost of PIN hashing on repeated invalid token attempts.
 *
 * Single-instance by design, matching LoginThrottle and the documented
 * shared-storage caveat for multi-instance deployments.
 */
@Injectable()
export class RecoveryThrottle {
  private readonly hits = new Map<string, number[]>();
  private readonly limit = 20;
  private readonly windowMs = 10 * 60_000;

  /** Milliseconds to wait, or 0 when this request is allowed (and recorded). */
  hit(key: string): number {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter(
      (t) => now - t < this.windowMs,
    );
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return this.windowMs - (now - recent[0]!);
    }
    recent.push(now);
    this.hits.set(key, recent);

    // Bound memory: drop the oldest keys when the table grows.
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) {
        if (v.every((t) => now - t >= this.windowMs)) this.hits.delete(k);
      }
    }
    return 0;
  }
}
