import { describe, expect, it } from "vitest";
import {
  isValidNgPhone,
  normalizeNgPhone,
  PhoneNormalizationError,
} from "./phone";

describe("normalizeNgPhone", () => {
  it("normalises local 0-prefixed format", () => {
    expect(normalizeNgPhone("08031234567")).toBe("+2348031234567");
  });

  it("normalises format without leading zero", () => {
    expect(normalizeNgPhone("8031234567")).toBe("+2348031234567");
  });

  it("normalises already-E.164 format", () => {
    expect(normalizeNgPhone("+2348031234567")).toBe("+2348031234567");
  });

  it("normalises 234-prefixed format", () => {
    expect(normalizeNgPhone("2348031234567")).toBe("+2348031234567");
  });

  it("strips spaces, dashes and parentheses", () => {
    expect(normalizeNgPhone("+234 803-123 (4567)")).toBe("+2348031234567");
  });

  it("rejects too-short numbers", () => {
    expect(() => normalizeNgPhone("0803123")).toThrow(PhoneNormalizationError);
  });

  it("rejects non-Nigerian numbers", () => {
    expect(() => normalizeNgPhone("+14155552671")).toThrow(
      PhoneNormalizationError,
    );
  });

  it("rejects garbage input", () => {
    expect(() => normalizeNgPhone("not-a-phone")).toThrow(
      PhoneNormalizationError,
    );
    expect(() => normalizeNgPhone("")).toThrow(PhoneNormalizationError);
  });

  it("isValidNgPhone mirrors normalize without throwing", () => {
    expect(isValidNgPhone("08031234567")).toBe(true);
    expect(isValidNgPhone("12345")).toBe(false);
  });
});
