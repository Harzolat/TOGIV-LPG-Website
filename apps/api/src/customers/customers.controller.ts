import { Controller, Delete, Get, NotFoundException, Param, Query, Req } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { RequireAudience, RequirePermission } from "../auth/auth.guard";
import type { AuthedRequest } from "../auth/auth.guard";
import { normalizeNgPhone } from "../common/phone";

/**
 * Staff customer directory — read-only in Phase 1.
 *
 * The console's Customers screen (list → detail) needs a stable, minimal
 * projection of the customer profile: identity, where they are, and their
 * recent activity. Writes (edit/suspend/export) stay behind the existing
 * `customer:edit` / `customer:suspend` permissions and are not exposed until
 * their workflows are specified.
 *
 * Directory access requires `customer:view_all` (admin/super_admin). Agents
 * hold `customer:view_scoped` — they see customer names through the request
 * and claim queues, which is exactly the scope that permission describes.
 */
@Controller("customers")
export class CustomersController {
  constructor(private readonly prisma: PrismaClient) {}

  @Get()
  @RequireAudience("admin")
  @RequirePermission("customer:view_all")
  async list(@Query("q") q?: string) {
    const term = q?.trim();
    // Operators type phone numbers the local way (0803…) while numbers are
    // stored as E.164 (+234803…). Normalise when possible so both forms
    // find the same customer; names fall through unchanged.
    const phoneTerm = (() => {
      if (!term) return term;
      try {
        return normalizeNgPhone(term);
      } catch {
        return term;
      }
    })();
    const rows = await this.prisma.customerProfile.findMany({
      where: {
        user: { deletedAt: null },
        ...(term
          ? {
              OR: [
                { fullName: { contains: term, mode: "insensitive" as const } },
                { user: { phone: { contains: phoneTerm } } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        user: { select: { phone: true, email: true, status: true } },
        _count: { select: { requests: true } },
      },
    });

    return {
      customers: rows.map((c) => ({
        id: c.id,
        fullName: c.fullName,
        phone: c.user.phone,
        email: c.user.email,
        state: c.state,
        lga: c.lga,
        status: c.user.status,
        suspendedAt: c.suspendedAt,
        createdAt: c.createdAt,
        requestCount: c._count.requests,
      })),
    };
  }

  @Get(":id")
  @RequireAudience("admin")
  @RequirePermission("customer:view_all")
  async detail(@Param("id") id: string) {
    const customer = await this.prisma.customerProfile.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            phone: true,
            email: true,
            status: true,
            createdAt: true,
            lastLoginAt: true,
            deletedAt: true,
          },
        },
        addresses: {
          where: { deletedAt: null },
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        },
        cylinders: {
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            serial: true,
            label: true,
            condition: true,
            cylinderType: { select: { capacityKg: true } },
          },
        },
        requests: {
          orderBy: { createdAt: "desc" },
          take: 10,
          select: { id: true, reference: true, type: true, status: true, createdAt: true },
        },
        claims: {
          orderBy: { createdAt: "desc" },
          take: 10,
          select: {
            id: true,
            claimType: true,
            createdAt: true,
            state: { select: { currentState: true } },
          },
        },
      },
    });

    if (!customer || customer.user.deletedAt) {
      throw new NotFoundException("Customer not found.");
    }

    return {
      id: customer.id,
      fullName: customer.fullName,
      phone: customer.user.phone,
      email: customer.user.email,
      state: customer.state,
      lga: customer.lga,
      preferredContact: customer.preferredContact,
      marketingConsent: customer.marketingConsent,
      suspendedAt: customer.suspendedAt,
      status: customer.user.status,
      createdAt: customer.createdAt,
      addresses: customer.addresses,
      cylinders: customer.cylinders.map((c) => ({
        id: c.id,
        serial: c.serial,
        label: c.label,
        condition: c.condition,
        capacityKg: c.cylinderType.capacityKg,
      })),
      requests: customer.requests,
      claims: customer.claims.map((c) => ({
        id: c.id,
        claimType: c.claimType,
        createdAt: c.createdAt,
        state: c.state?.currentState ?? "pending",
      })),
    };
  }

  @Delete(":id")
  @RequireAudience("admin")
  @RequirePermission("customer:suspend")
  async remove(@Param("id") id: string, @Req() req: AuthedRequest) {
    const customer = await this.prisma.customerProfile.findUnique({
      where: { id },
      select: { id: true, userId: true, user: { select: { deletedAt: true } } },
    });
    if (!customer || customer.user.deletedAt) {
      throw new NotFoundException("Customer not found.");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: customer.userId },
        data: { deletedAt: new Date(), status: "deleted" },
      });
      await tx.session.updateMany({
        where: { userId: customer.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user?.id ?? null,
          action: "customer.deleted",
          entityType: "customer",
          entityId: customer.id,
          after: { status: "deleted", permanent: true },
        },
      });
    });

    return { ok: true };
  }
}
