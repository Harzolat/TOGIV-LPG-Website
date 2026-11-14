import { Module, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
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
import { DeliveryService } from "./deliveries/delivery.service";
import { OutboxWorker } from "./notifications/outbox.worker";
import { QrController } from "./qr/qr.controller";
import { QrService } from "./qr/qr.service";
import { RequestService } from "./requests/request.service";
import { RequestsController } from "./requests/requests.controller";

/**
 * App wiring — Phase 1A modules.
 * AuthGuard runs globally: public routes pass through (with optional
 * session resolution), metadata routes enforce audience + permission.
 */

const prismaProvider = {
  provide: PrismaClient,
  useFactory: () =>
    new PrismaClient({
      adapter: new PrismaPg({
        connectionString:
          process.env.DATABASE_URL ?? "postgresql://user:password@localhost:5432/togiv_lpg?schema=public",
      }),
    }),
};

@Module({
  imports: [],
  controllers: [
    AuthController,
    CustomerCredentialsController,
    StaffAuthController,
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
    private readonly outbox: OutboxWorker,
  ) {}

  onModuleInit() {
    this.outbox.start(5_000);
  }

  async onModuleDestroy() {
    this.outbox.stop();
    await this.prisma.$disconnect();
  }
}
