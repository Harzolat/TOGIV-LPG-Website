import { describe, expect, it } from "vitest";
import {
  canCreateRetry,
  canTransition,
  CUSTOMER_CANCELABLE,
  isTerminal,
  nextStaffStep,
  parentEffectFor,
  TransitionError,
  validateTransition,
  type ActorKind,
  type RequestStatus,
  type RequestType,
} from "./transitions";

const ALL_STATUSES: RequestStatus[] = [
  "Submitted",
  "Received",
  "UnderReview",
  "Accepted",
  "Processing",
  "Dispatched",
  "Completed",
  "Resolved",
  "Rejected",
  "Cancelled",
  "Escalated",
];

const ACTORS: ActorKind[] = ["system", "customer", "staff"];

/** Exhaustive: every (type, from, to, actor) combination is checked. */
function check(
  type: RequestType,
  from: RequestStatus,
  to: RequestStatus,
  actor: ActorKind,
  reason = "because",
) {
  return canTransition({ type, from, to, actor, reason });
}

describe("terminal state immutability (all types)", () => {
  const cases: Array<[RequestType, RequestStatus]> = [
    ["refill", "Completed"],
    ["refill", "Rejected"],
    ["refill", "Cancelled"],
    ["complaint", "Resolved"],
    ["complaint", "Rejected"],
    ["complaint", "Cancelled"],
    ["enquiry", "Completed"],
    ["enquiry", "Rejected"],
    ["enquiry", "Cancelled"],
  ];

  it.each(cases)("%s in %s rejects every possible transition", (type, terminal) => {
    for (const to of ALL_STATUSES) {
      for (const actor of ACTORS) {
        expect(check(type, terminal, to, actor)).toBe(false);
      }
    }
    expect(isTerminal(type, terminal)).toBe(true);
  });
});

describe("refill matrix (v1.2.4 §4.1)", () => {
  it("permits the documented happy path", () => {
    expect(check("refill", "Submitted", "Received", "staff")).toBe(true);
    expect(check("refill", "Received", "UnderReview", "staff")).toBe(true);
    expect(check("refill", "UnderReview", "Accepted", "staff")).toBe(true);
    expect(check("refill", "Accepted", "Processing", "staff")).toBe(true);
    expect(check("refill", "Processing", "Dispatched", "staff")).toBe(true);
    expect(check("refill", "Processing", "Dispatched", "system")).toBe(true);
    expect(check("refill", "Dispatched", "Completed", "system")).toBe(true); // D4
    expect(check("refill", "Processing", "Completed", "staff")).toBe(true); // station counter
  });

  it("station drop-off: Accepted → Processing → Completed is valid", () => {
    expect(check("refill", "Accepted", "Processing", "staff")).toBe(true);
    expect(check("refill", "Processing", "Completed", "staff")).toBe(true);
  });

  it("D1: only system may move Dispatched → Processing", () => {
    expect(check("refill", "Dispatched", "Processing", "system")).toBe(true);
    expect(check("refill", "Dispatched", "Processing", "staff")).toBe(false);
    expect(check("refill", "Dispatched", "Processing", "customer")).toBe(false);
  });

  it("D2: Rejected valid ONLY from Dispatched (or UnderReview), never from Accepted/Processing", () => {
    expect(check("refill", "Dispatched", "Rejected", "staff")).toBe(true);
    expect(check("refill", "UnderReview", "Rejected", "staff")).toBe(true);
    expect(check("refill", "Accepted", "Rejected", "staff")).toBe(false); // v1.2.2 A1.1
    expect(check("refill", "Processing", "Rejected", "staff")).toBe(false);
  });

  it("customer cancellation only before acceptance", () => {
    for (const from of CUSTOMER_CANCELABLE) {
      expect(check("refill", from, "Cancelled", "customer")).toBe(true);
    }
    expect(check("refill", "Accepted", "Cancelled", "customer")).toBe(false);
    expect(check("refill", "Processing", "Cancelled", "customer")).toBe(false);
    expect(check("refill", "Dispatched", "Cancelled", "customer")).toBe(false);
  });

  it("staff cancellation needs a reason", () => {
    expect(
      canTransition({ type: "refill", from: "Accepted", to: "Cancelled", actor: "staff" }),
    ).toBe(false);
    expect(check("refill", "Accepted", "Cancelled", "staff")).toBe(true);
  });

  it("rejects invalid transitions", () => {
    expect(check("refill", "Submitted", "Completed", "staff")).toBe(false);
    expect(check("refill", "Submitted", "Dispatched", "staff")).toBe(false);
    expect(check("refill", "Accepted", "Dispatched", "staff")).toBe(false);
    expect(check("refill", "UnderReview", "Processing", "staff")).toBe(false);
  });

  it("Escalated does not exist on refills", () => {
    for (const from of ALL_STATUSES) {
      expect(check("refill", from, "Escalated", "staff")).toBe(false);
    }
  });
});

describe("complaint matrix (v1.2.4 §4.2)", () => {
  it("escalation entry requires staff + reason", () => {
    for (const from of ["UnderReview", "Accepted", "Processing"] as const) {
      expect(check("complaint", from, "Escalated", "staff")).toBe(true);
      expect(
        canTransition({ type: "complaint", from, to: "Escalated", actor: "staff" }),
      ).toBe(false);
    }
    expect(check("complaint", "Submitted", "Escalated", "staff")).toBe(false);
    expect(check("complaint", "Received", "Escalated", "staff")).toBe(false);
  });

  it("Escalated exits ONLY to UnderReview | Processing | Resolved | Cancelled(staff)", () => {
    const valid: RequestStatus[] = ["UnderReview", "Processing", "Resolved", "Cancelled"];
    for (const to of ALL_STATUSES) {
      const expected = valid.includes(to);
      expect(check("complaint", "Escalated", to, "staff")).toBe(expected);
    }
    // No Rejected from Escalated (v1.2.2), no customer cancel
    expect(check("complaint", "Escalated", "Rejected", "staff")).toBe(false);
    expect(check("complaint", "Escalated", "Cancelled", "customer")).toBe(false);
    expect(check("complaint", "Escalated", "Accepted", "staff")).toBe(false);
  });

  it("complaints terminate at Resolved, never Completed", () => {
    expect(check("complaint", "Processing", "Resolved", "staff")).toBe(true);
    expect(check("complaint", "Processing", "Completed", "staff")).toBe(false);
    expect(isTerminal("complaint", "Resolved")).toBe(true);
    expect(isTerminal("complaint", "Completed")).toBe(false);
  });
});

describe("enquiry matrix (v1.2.4 §4.3)", () => {
  it("completes only from UnderReview", () => {
    expect(check("enquiry", "UnderReview", "Completed", "staff")).toBe(true);
    expect(check("enquiry", "Submitted", "Completed", "staff")).toBe(false);
    expect(check("enquiry", "Received", "Completed", "staff")).toBe(false);
  });
});

describe("actor permission enforcement", () => {
  it("customers cannot perform staff transitions", () => {
    expect(check("refill", "Submitted", "Received", "customer")).toBe(false);
    expect(check("refill", "UnderReview", "Accepted", "customer")).toBe(false);
    expect(check("complaint", "Processing", "Resolved", "customer")).toBe(false);
  });

  it("system only acts where derived (delivery coupling)", () => {
    expect(check("refill", "Submitted", "Received", "system")).toBe(false);
    expect(check("refill", "UnderReview", "Accepted", "system")).toBe(false);
    expect(check("refill", "Processing", "Dispatched", "system")).toBe(true);
    expect(check("refill", "Dispatched", "Completed", "system")).toBe(true);
  });
});

describe("delivery → parent coupling (v1.2.4 §4.4)", () => {
  it("preparing: Accepted → Processing only", () => {
    expect(parentEffectFor("preparing", "Accepted", { retryable: true, canRetry: true })).toEqual({
      from: "Accepted",
      to: "Processing",
      actor: "system",
    });
    expect(parentEffectFor("preparing", "Processing", { retryable: true, canRetry: true })).toBeNull();
  });

  it("dispatched: Processing → Dispatched only", () => {
    expect(parentEffectFor("dispatched", "Processing", { retryable: true, canRetry: true })).toEqual({
      from: "Processing",
      to: "Dispatched",
      actor: "system",
    });
    expect(parentEffectFor("dispatched", "Accepted", { retryable: true, canRetry: true })).toBeNull();
  });

  it("delivered (D4): Dispatched → Completed only", () => {
    expect(parentEffectFor("delivered", "Dispatched", { retryable: true, canRetry: true })).toEqual({
      from: "Dispatched",
      to: "Completed",
      actor: "system",
    });
    expect(parentEffectFor("delivered", "Processing", { retryable: true, canRetry: true })).toBeNull();
  });

  it("failed (D1): Dispatched → Processing only when retryable AND canRetry", () => {
    expect(parentEffectFor("failed", "Dispatched", { retryable: true, canRetry: true })).toEqual({
      from: "Dispatched",
      to: "Processing",
      actor: "system",
    });
    // exhausted or non-retryable → parent stays Dispatched (staff resolve via A1.1)
    expect(parentEffectFor("failed", "Dispatched", { retryable: true, canRetry: false })).toBeNull();
    expect(parentEffectFor("failed", "Dispatched", { retryable: false, canRetry: true })).toBeNull();
    // failed from Assigned → parent stays Accepted
    expect(parentEffectFor("failed", "Accepted", { retryable: true, canRetry: true })).toBeNull();
    // failed from Preparing → parent stays Processing
    expect(parentEffectFor("failed", "Processing", { retryable: true, canRetry: true })).toBeNull();
  });

  it("every derived effect is itself a valid refill matrix transition", () => {
    const events = ["preparing", "dispatched", "delivered", "failed"] as const;
    const parents: RequestStatus[] = ["Accepted", "Processing", "Dispatched"];
    for (const event of events) {
      for (const parent of parents) {
        const effect = parentEffectFor(event, parent, { retryable: true, canRetry: true });
        if (effect) {
          expect(
            check("refill", effect.from, effect.to, effect.actor),
            `${event} from ${parent}: ${effect.from} → ${effect.to}`,
          ).toBe(true);
        }
      }
    }
  });
});

describe("retry eligibility — v1.2.4 corrected semantics", () => {
  it("max_retries = 2 allows original + 2 retries = 3 total attempts", () => {
    expect(canCreateRetry(1, 2, false)).toBe(true); // after original failed
    expect(canCreateRetry(2, 2, false)).toBe(true); // after retry1 failed
    expect(canCreateRetry(3, 2, false)).toBe(false); // after retry2 failed → exhausted
  });

  it("never creates a retry for a terminal parent refill", () => {
    expect(canCreateRetry(1, 5, true)).toBe(false);
  });

  it("max_retries = 0 means only the original attempt", () => {
    expect(canCreateRetry(1, 0, false)).toBe(false);
  });
});

describe("nextStaffStep", () => {
  it("walks the normal refill chain", () => {
    expect(nextStaffStep("refill", "Submitted")).toEqual({
      to: "Received",
      reasonRequired: false,
    });
    expect(nextStaffStep("refill", "UnderReview")?.to).toBe("Accepted");
    expect(nextStaffStep("refill", "Processing")?.to).toBe("Dispatched");
    expect(nextStaffStep("refill", "Dispatched")?.to).toBe("Completed");
  });

  it("marks complaint resolution as reason-required", () => {
    expect(nextStaffStep("complaint", "Processing")).toEqual({
      to: "Resolved",
      reasonRequired: true,
    });
  });

  it("completes an enquiry after review", () => {
    expect(nextStaffStep("enquiry", "UnderReview")).toEqual({
      to: "Completed",
      reasonRequired: false,
    });
  });

  it("returns null on terminal states", () => {
    expect(nextStaffStep("refill", "Completed")).toBeNull();
    expect(nextStaffStep("complaint", "Rejected")).toBeNull();
  });

  it("every step it returns is a valid staff transition", () => {
    for (const type of ["refill", "complaint", "enquiry"] as RequestType[]) {
      for (const from of ALL_STATUSES) {
        const step = nextStaffStep(type, from);
        if (!step) continue;
        expect(
          canTransition({
            type,
            from,
            to: step.to,
            actor: "staff",
            reason: step.reasonRequired ? "because" : undefined,
          }),
        ).toBe(true);
      }
    }
  });
});

describe("TransitionError codes", () => {
  it("reports TERMINAL_STATE distinctly", () => {
    try {
      validateTransition({ type: "refill", from: "Completed", to: "Processing", actor: "staff" });
      expect.unreachable();
    } catch (e) {
      expect((e as TransitionError).code).toBe("TERMINAL_STATE");
    }
  });

  it("reports ACTOR_NOT_PERMITTED distinctly", () => {
    try {
      validateTransition({ type: "refill", from: "UnderReview", to: "Accepted", actor: "customer" });
      expect.unreachable();
    } catch (e) {
      expect((e as TransitionError).code).toBe("ACTOR_NOT_PERMITTED");
    }
  });

  it("reports REASON_REQUIRED distinctly", () => {
    try {
      validateTransition({ type: "refill", from: "UnderReview", to: "Rejected", actor: "staff" });
      expect.unreachable();
    } catch (e) {
      expect((e as TransitionError).code).toBe("REASON_REQUIRED");
    }
  });
});
