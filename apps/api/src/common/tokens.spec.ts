import { describe, expect, it } from "vitest";
import {
  generateOpaqueToken,
  generateOtpCode,
  hashOtp,
  hashToken,
  verifyOtp,
} from "./tokens";

describe("opaque tokens", () => {
  it("generates unique high-entropy tokens", () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url ≈ 43 chars (≥128-bit)
  });

  it("hashes deterministically and one-way", () => {
    const token = generateOpaqueToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("OTP codes", () => {
  it("generates 6-digit numeric codes", () => {
    for (let i = 0; i < 100; i++) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });

  it("verifies correct codes and rejects wrong ones", () => {
    const code = generateOtpCode();
    const hash = hashOtp(code);
    expect(verifyOtp(code, hash)).toBe(true);

    const wrong = code === "000000" ? "999999" : "000000";
    expect(verifyOtp(wrong, hash)).toBe(false);
  });

  it("produces a peppered 64-hex digest (not the raw code)", () => {
    const hash = hashOtp("123456");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("123456");
  });
});
