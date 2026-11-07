import type { PrismaClient } from "@prisma/client";

/**
 * Ensures every authenticated customer has exactly one CustomerProfile.
 * customerId on service_requests/claims references the PROFILE, not the user —
 * registration and linking depend on this invariant.
 */
export async function ensureCustomerProfile(
  prisma: PrismaClient,
  userId: string,
  fullName = "Valued customer",
): Promise<string> {
  const existing = await prisma.customerProfile.findUnique({ where: { userId } });
  if (existing) return existing.id;

  const created = await prisma.customerProfile.create({
    data: { userId, fullName },
  });
  return created.id;
}
