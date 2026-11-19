import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { AuthedRequest } from "../auth/auth.guard";
import { RequireAudience, RequirePermission } from "../auth/auth.guard";
import { normalizeNgPhone, PhoneNormalizationError } from "../common/phone";
import { validatePasswordStrength } from "../auth/password";

/**
 * Staff account management — super administrators only (staff:manage).
 * Email + password auth; phone is optional contact info.
 */

const createSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z
    .string()
    .trim()
    .email("Enter a valid email address.")
    .max(200)
    .transform((v) => v.toLowerCase()),
  phone: z.string().trim().max(20).optional().nullable(),
  department: z.string().trim().max(80).optional().nullable(),
  employeeRef: z.string().trim().max(40).optional().nullable(),
  roleKeys: z.array(z.string().min(1)).min(1).max(10),
  password: z.string().min(8).max(200),
});

@Controller("admin")
@RequireAudience("admin")
export class AdminStaffController {
  constructor(private readonly prisma: PrismaClient) {}

  /** List staff accounts (operators) for the team console. */
  @Get("staff")
  @RequirePermission("staff:manage")
  async listStaff() {
    const users = await this.prisma.user.findMany({
      where: { kind: "staff", deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        phone: true,
        email: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
        staffProfile: {
          select: {
            fullName: true,
            department: true,
            employeeRef: true,
            totpEnrolledAt: true,
          },
        },
        roles: { select: { role: { select: { key: true } } } },
      },
    });

    return {
      staff: users.map((user) => ({
        id: user.id,
        phone: user.phone,
        email: user.email,
        status: user.status,
        fullName: user.staffProfile?.fullName ?? "—",
        department: user.staffProfile?.department ?? null,
        employeeRef: user.staffProfile?.employeeRef ?? null,
        roles: user.roles.map((r) => r.role.key),
        totpEnrolled: Boolean(user.staffProfile?.totpEnrolledAt),
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
      })),
    };
  }

  /** Roles available for staff assignment (excludes the customer role). */
  @Get("roles")
  @RequirePermission("staff:manage")
  async listRoles() {
    const roles = await this.prisma.role.findMany({
      where: { key: { not: "customer" } },
      orderBy: { key: "asc" },
      select: { key: true, label: true, description: true },
    });
    return { roles };
  }

  /** Create a staff account and assign roles. */
  @Post("staff")
  @RequirePermission("staff:manage")
  async createStaff(@Body() body: unknown, @Req() req: AuthedRequest) {
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues
          .map((i) => `${i.path.join(".") || "field"}: ${i.message}`)
          .join("; "),
      );
    }

    const data = parsed.data;

    const strength = validatePasswordStrength(data.password);
    if (strength) throw new BadRequestException(strength);

    const roleKeys = [...new Set(data.roleKeys)].filter((k) => k !== "customer");
    if (roleKeys.length === 0) {
      throw new BadRequestException("Select at least one staff role.");
    }

    const roles = await this.prisma.role.findMany({
      where: { key: { in: roleKeys } },
      select: { id: true, key: true },
    });
    if (roles.length !== roleKeys.length) {
      throw new BadRequestException("One or more selected roles are not valid.");
    }

    const email = data.email;
    const existingEmail = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" }, deletedAt: null },
      select: { id: true },
    });
    if (existingEmail) {
      throw new ConflictException("This email is already used by an account.");
    }

    let phone: string | null = null;
    const rawPhone = data.phone?.trim();
    if (rawPhone) {
      try {
        phone = normalizeNgPhone(rawPhone);
      } catch (e) {
        if (e instanceof PhoneNormalizationError) {
          throw new BadRequestException("Enter a valid Nigerian phone number.");
        }
        throw e;
      }
      const existingPhone = await this.prisma.user.findFirst({
        where: { phone, deletedAt: null },
        select: { id: true },
      });
      if (existingPhone) {
        throw new ConflictException(
          "This phone number is already used by an account.",
        );
      }
    }

    const passwordHash = await bcrypt.hash(data.password, 10);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          phone,
          passwordHash,
          kind: "staff",
          status: "active",
        },
      });

      await tx.staffProfile.create({
        data: {
          userId: created.id,
          fullName: data.fullName,
          department: data.department ?? null,
          employeeRef: data.employeeRef ?? null,
        },
      });

      for (const role of roles) {
        await tx.userRole.create({
          data: { userId: created.id, roleId: role.id },
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: req.user?.id ?? null,
          action: "staff.created",
          entityType: "user",
          entityId: created.id,
          after: {
            email: created.email,
            phone: created.phone,
            roles: roleKeys,
          },
        },
      });

      return created;
    });

    return {
      ok: true,
      staff: {
        id: user.id,
        phone: user.phone,
        email: user.email,
        fullName: data.fullName,
        department: data.department ?? null,
        roles: roleKeys,
        totpEnrolled: false,
      },
    };
  }

  @Delete("staff/:id")
  @RequirePermission("staff:manage")
  async removeStaff(@Param("id") id: string, @Req() req: AuthedRequest) {
    if (req.user?.id === id) {
      throw new ForbiddenException("You cannot delete your own account.");
    }

    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, kind: true, deletedAt: true },
    });
    if (!user || user.kind !== "staff" || user.deletedAt) {
      throw new ForbiddenException("Staff account not found.");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { deletedAt: new Date(), status: "deleted" },
      });
      await tx.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user?.id ?? null,
          action: "staff.deleted",
          entityType: "user",
          entityId: id,
          after: { status: "deleted" },
        },
      });
    });

    return { ok: true };
  }
}
