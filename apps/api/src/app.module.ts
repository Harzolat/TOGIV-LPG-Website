import {
  Inject,
  Module,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { AdminController } from "./admin/admin.controller";
import { AdminStaffController } from "./admin/staff.controller";
import { AuthController } from "./auth/auth.controller";
import { AuthGuard } from "./auth/auth.guard";
import { CustomerCredentialsController } from "./auth/customer-credentials.controller";
import { LoginThrottle } from "./auth/login-throttle";
import { SessionService } from "./auth/session.service";
import { StaffAuthController } from "./auth/staff.controller";
import { ClaimService } from "./claims/claim.service";
import { ClaimsController } from "./claims/claim.controller";
import { CustomersController } from "./customers/customers.controller";
import { CylindersController } from "./cylinders/cylinders.controller";
import { getDatabaseUrl } from "./database/database-url";
import { DeliveryService } from "./deliveries/delivery.service";
import { HealthController } from "./health/health.controller";
import {
  createHealthPrismaClient,
  HEALTH_PRISMA,
} from "./health/health.database";
import { OutboxWorker } from "./notifications/outbox.worker";
import { QrController } from "./qr/qr.controller";
import { QrService } from "./qr/qr.service";
import { RequestService } from "./requests/request.service";
import { RequestsController } from "./requests/requests.controller";

/**
 * App wiring — Phase 1A modules.
 * AuthGuard runs globally: explicitly @Public routes bypass it, other
 * unannotated routes retain optional session resolution, and metadata routes
 * enforce audience + permission.
 */

const prismaProvider = {
  provide: PrismaClient,
  useFactory: () =>
    new PrismaClient({
      adapter: new PrismaPg({
        connectionString: getDatabaseUrl(),
      }),
    }),
};

const healthPrismaProvider = {
  provide: HEALTH_PRISMA,
  useFactory: createHealthPrismaClient,
};

@Module({
  imports: [],
  controllers: [
    AuthController,
    CustomerCredentialsController,
    StaffAuthController,
    HealthController,
    AdminController,
    AdminStaffController,
    QrController,
    RequestsController,
    ClaimsController,
    CylindersController,
    CustomersController,
  ],
  providers: [
    prismaProvider,
    healthPrismaProvider,
    { provide: APP_GUARD, useClass: AuthGuard },
    SessionService,
    LoginThrottle,
    AuthGuard,
    QrService,
    RequestService,
    ClaimService,
    DeliveryService,
    OutboxWorker,
  ],
  exports: [PrismaClient, SessionService, AuthGuard],
})
export class AppModule implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly prisma: PrismaClient,
    @Inject(HEALTH_PRISMA) private readonly healthPrisma: PrismaClient,
    private readonly outbox: OutboxWorker,
  ) {}

  onModuleInit() {
    this.outbox.start(5_000);
  }

  async onModuleDestroy() {
    this.outbox.stop();
    await Promise.all([
      this.prisma.$disconnect(),
      this.healthPrisma.$disconnect(),
    ]);
  }
}
