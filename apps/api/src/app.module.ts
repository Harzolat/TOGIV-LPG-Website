import { Module, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { AuthController } from "./auth/auth.controller";
import { AuthGuard } from "./auth/auth.guard";
import { DevSmsAdapter, OtpService, SmsProvider } from "./auth/otp.service";
import { SessionService } from "./auth/session.service";
import { OutboxWorker } from "./notifications/outbox.worker";

/**
 * App wiring — Phase 1A core modules.
 * Controllers for requests/claims/deliveries/QR land with their routes in
 * the next steps; services are already in place.
 */

const prismaProvider = {
  provide: PrismaClient,
  useFactory: () => new PrismaClient(),
};

const smsProvider: SmsProvider = new DevSmsAdapter(); // launch: swap via env

@Module({
  imports: [],
  controllers: [AuthController],
  providers: [
    prismaProvider,
    { provide: SmsProvider, useValue: smsProvider },
    OtpService,
    SessionService,
    AuthGuard,
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
