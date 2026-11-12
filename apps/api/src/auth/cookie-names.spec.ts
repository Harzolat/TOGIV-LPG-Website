import { describe, expect, it } from "vitest";
import { declaredAudience, sessionAudienceFromCookies } from "./cookie-names";

/**
 * Regression guard for the cross-audience mix-up: cookies are shared across
 * ports on localhost, so a signed-in admin console used to make the customer
 * app read the admin session (and demand the admin CSRF token). The SPA's
 * declared audience must always win; the cookie tie-break only applies to
 * header-less callers.
 */
describe("declaredAudience", () => {
  it("accepts only the two known audiences", () => {
    expect(declaredAudience({ "x-togi-audience": "customer" })).toBe("customer");
    expect(declaredAudience({ "x-togi-audience": "admin" })).toBe("admin");
    expect(declaredAudience({ "x-togi-audience": "root" })).toBeNull();
    expect(declaredAudience({})).toBeNull();
    expect(declaredAudience(undefined)).toBeNull();
  });

  it("uses the first value when a header is repeated", () => {
    expect(declaredAudience({ "x-togi-audience": ["admin", "customer"] })).toBe("admin");
  });
});

describe("sessionAudienceFromCookies", () => {
  it("prefers the customer session when both cookies are present", () => {
    expect(sessionAudienceFromCookies({ app_sid: "c", admin_sid: "a" })).toBe("customer");
  });

  it("falls back to whichever audience holds a session", () => {
    expect(sessionAudienceFromCookies({ admin_sid: "a" })).toBe("admin");
    expect(sessionAudienceFromCookies({ app_sid: "c" })).toBe("customer");
    expect(sessionAudienceFromCookies({})).toBeNull();
    expect(sessionAudienceFromCookies(undefined)).toBeNull();
  });
});
