import { z } from "zod";

/**
 * Request submission DTOs — zod-validated per type (v1.2 §1.4.2).
 * payload is stored as-is after validation; the request engine treats it
 * as opaque JSON with type-specific meaning.
 */

const phone = z.string().min(6).max(20);

const refillPayload = z.object({
  capacityKg: z.number().positive().max(100),
  quantity: z.number().int().min(1).max(50).default(1),
  cylinderId: z.string().optional(),
  notes: z.string().max(500).optional(),
});

const complaintPayload = z.object({
  category: z.string().min(3).max(80),
  description: z.string().min(10).max(2000),
  deliveryId: z.string().optional(),
});

const enquiryPayload = z.object({
  subject: z.string().min(3).max(120),
  message: z.string().min(5).max(2000),
});

/** Inline home-delivery address. Authenticated: promoted to an address row.
 *  Guests: stored as a snapshot inside the request payload (address rows
 *  require a customer profile — v1.2 §1.4.2, no silent account creation). */
const inlineAddress = z.object({
  line1: z.string().min(3).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().min(1).max(100),
  state: z.string().min(1).max(100),
  lga: z.string().min(1).max(100),
  label: z.string().max(40).optional(),
  deliveryNote: z.string().max(300).optional(),
});

export const submitRequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("refill"),
    contactPhone: phone,
    payload: refillPayload,
    deliveryMethod: z.enum(["home", "station"]).default("station"),
    addressId: z.string().optional(),
    address: inlineAddress.optional(),
    zoneId: z.string().optional(),
  }),
  z.object({
    type: z.literal("complaint"),
    contactPhone: phone,
    payload: complaintPayload,
  }),
  z.object({
    type: z.literal("enquiry"),
    contactPhone: phone,
    payload: enquiryPayload,
  }),
]);

export type SubmitRequestDto = z.infer<typeof submitRequestSchema>;

export const transitionSchema = z.object({
  to: z.enum([
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
  ]),
  reason: z.string().max(500).optional(),
  note: z.string().max(1000).optional(),
});

export const cancelSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const linkConfirmSchema = z.object({
  requestIds: z.array(z.string().min(1)).min(1).max(50),
});
