import { Controller, Get } from "@nestjs/common";
import { PrismaClient, RequestStatus } from "@prisma/client";
import { RequireAudience, RequirePermission } from "../auth/auth.guard";

/**
 * Operations overview — the admin console's landing page.
 *
 * One round trip gives the console everything it needs to triage a busy
 * queue: live status counts, the oldest requests waiting on a human, the
 * most recent status moves, and today's workload per staff member.
 *
 * Read-only and aggregate-only. It reuses `request:view_all` (every staff
 * role that can work the queue) and `claim:view` is held by those same
 * roles, so the claim count leaks nothing.
 */

const ACTIVE: RequestStatus[] = [
  "Submitted",
  "Received",
  "UnderReview",
  "Accepted",
  "Processing",
  "Dispatched",
];

const ALL: RequestStatus[] = [
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

@Controller("admin")
export class AdminController {
  constructor(private readonly prisma: PrismaClient) {}

  @Get("overview")
  @RequireAudience("admin")
  @RequirePermission("request:view_all")
  async overview() {
    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );

    const [
      statusRows,
      openClaims,
      completedToday,
      oldestWaiting,
      activity,
      todayStaff,
    ] = await Promise.all([
      this.prisma.serviceRequest.groupBy({
        by: ["status"],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.cylinderClaimState.count({
        where: { currentState: "pending" },
      }),
      this.prisma.serviceRequest.count({
        where: { deletedAt: null, completedAt: { gte: startOfToday } },
      }),
      this.prisma.serviceRequest.findMany({
        where: {
          deletedAt: null,
          status: { in: ["Submitted", "UnderReview"] },
        },
        orderBy: { createdAt: "asc" },
        take: 5,
        select: {
          id: true,
          reference: true,
          type: true,
          status: true,
          contactPhone: true,
          createdAt: true,
          updatedAt: true,
          customer: { select: { id: true, fullName: true } },
        },
      }),
      this.prisma.requestStatusHistory.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        include: {
          request: { select: { reference: true, type: true } },
        },
      }),
      this.prisma.requestStatusHistory.findMany({
        where: { createdAt: { gte: startOfToday }, actorKind: "staff" },
        select: { actorId: true },
      }),
    ]);

    const counts: Record<RequestStatus, number> = {
      Submitted: 0,
      Received: 0,
      UnderReview: 0,
      Accepted: 0,
      Processing: 0,
      Dispatched: 0,
      Completed: 0,
      Resolved: 0,
      Rejected: 0,
      Cancelled: 0,
      Escalated: 0,
    };
    for (const row of statusRows) counts[row.status] = row._count._all;

    // Resolve display names once for both the activity feed and the
    // today-per-staff tally.
    const actorIds = [
      ...new Set(
        [...activity, ...todayStaff]
          .map((row) => row.actorId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: {
            id: true,
            staffProfile: { select: { fullName: true } },
            customerProfile: { select: { fullName: true } },
          },
        })
      : [];
    const nameOf = new Map(
      actors.map((actor) => [
        actor.id,
        actor.staffProfile?.fullName ??
          actor.customerProfile?.fullName ??
          null,
      ]),
    );

    const byActor = new Map<
      string,
      { actorId: string; name: string; count: number }
    >();
    for (const row of todayStaff) {
      if (!row.actorId) continue;
      const entry = byActor.get(row.actorId) ?? {
        actorId: row.actorId,
        name: nameOf.get(row.actorId) ?? "Staff",
        count: 0,
      };
      entry.count += 1;
      byActor.set(row.actorId, entry);
    }

    return {
      generatedAt: now.toISOString(),
      counts: {
        submitted: counts.Submitted,
        received: counts.Received,
        underReview: counts.UnderReview,
        accepted: counts.Accepted,
        processing: counts.Processing,
        dispatched: counts.Dispatched,
        active: ACTIVE.reduce((sum, status) => sum + counts[status], 0),
        needsAttention: counts.Submitted + counts.UnderReview,
        completedToday,
        openClaims,
      },
      byStatus: ALL.map((status) => ({ status, count: counts[status] })),
      oldestWaiting,
      activity: activity.map((row) => ({
        id: row.id,
        reference: row.request.reference,
        type: row.request.type,
        fromStatus: row.fromStatus,
        toStatus: row.toStatus,
        actorKind: row.actorKind,
        actorName: row.actorId
          ? (nameOf.get(row.actorId) ?? null)
          : null,
        createdAt: row.createdAt.toISOString(),
      })),
      todayByActor: [...byActor.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
    };
  }
}
