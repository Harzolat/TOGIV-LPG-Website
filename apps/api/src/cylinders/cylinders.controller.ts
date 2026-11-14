import { Controller, Get, Req } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import type { AuthedRequest } from "../auth/auth.guard";
import { RequireAudience } from "../auth/auth.guard";
import { ensureCustomerProfile } from "../auth/customer-profile";

/**
 * Customer cylinder endpoints.
 *
 * A "registered" cylinder is one linked to the customer's account for
 * service requests (claim/service registration) — never proof of legal
 * ownership (v1.2 A2). Linking happens only through the reviewed claim flow.
 */
@Controller("cylinders")
export class CylindersController {
  constructor(private readonly prisma: PrismaClient) {}

  /** Cylinders registered to the signed-in customer's account. */
  @Get("mine")
  @RequireAudience("customer")
  async mine(@Req() req: AuthedRequest) {
    const customerId = await ensureCustomerProfile(this.prisma, req.user!.id);
    const cylinders = await this.prisma.cylinder.findMany({
      where: { ownerCustomerId: customerId, deletedAt: null },
      orderBy: { registeredAt: "desc" },
      select: {
        id: true,
        serial: true,
        label: true,
        brand: true,
        condition: true,
        registeredAt: true,
        cylinderType: { select: { capacityKg: true, label: true } },
      },
    });
    return { cylinders };
  }
}
