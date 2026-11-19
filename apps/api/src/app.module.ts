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
import { AdminRecoveryController } from "./admin/recovery.controller";
import { AdminStaffController } from "./admin/staff.controller";
import { AuthController } from "./auth/auth.controller";
import { AuthGuard } from "./auth/auth.guard";
import { CustomerCredentialsController } from "./auth/customer-credentials.controller";
import { LoginThrottle } from "./auth/login-throttle";
import { RecoveryController } from "./auth/recovery.controller";
import { MailerService } from "./auth/mailer.service";
import { RecoveryService } from "./auth/recovery.service";
import { RecoveryThrottle } from "./auth/recovery-throttle";
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
import { NotificationEventsService } from "./notifications/notification-events.service";
import { NotificationService } from "./notifications/notification.service";
import { NotificationsController } from "./notifications/notifications.controller";
import { OutboxWorker } from "./notifications/outbox.worker";
import { PushSubscriptionController } from "./notifications/push/push-subscription.controller";
import { PushSubscriptionService } from "./notifications/push/push-subscription.service";
import { WebPushService } from "./notifications/push/web-push.service";
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
    RecoveryController,
    StaffAuthController,
    HealthController,
    AdminController,
    AdminRecoveryController,
    AdminStaffController,
    QrController,
    RequestsController,
    ClaimsController,
    CylindersController,
    CustomersController,
    NotificationsController,
    PushSubscriptionController,
  ],
  providers: [
    prismaProvider,
    healthPrismaProvider,
    { provide: APP_GUARD, useClass: AuthGuard },
    SessionService,
    LoginThrottle,
    RecoveryThrottle,
    MailerService,
    RecoveryService,
    AuthGuard,
    QrService,
    NotificationEventsService,
    WebPushService,
    PushSubscriptionService,
    NotificationService,
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
