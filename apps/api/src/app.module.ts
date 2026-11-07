import { Module, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { AuthController } from "./auth/auth.controller";
import { AuthGuard } from "./auth/auth.guard";
import { DevSmsAdapter, OtpService, SmsProvider } from "./auth/otp.service";
import { SessionService } from "./auth/session.service";
import { ClaimService } from "./claims/claim.service";
import { ClaimsController } from "./claims/claim.controller";
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

// Prisma 7 requires an explicit driver adapter (no implicit connection).
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

const smsProvider: SmsProvider = new DevSmsAdapter(); // launch: swap via env

@Module({
  imports: [],
  controllers: [AuthController, QrController, RequestsController, ClaimsController],
  providers: [
    prismaProvider,
    { provide: SmsProvider, useValue: smsProvider },
    { provide: APP_GUARD, useClass: AuthGuard },
    OtpService,
    SessionService,
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
