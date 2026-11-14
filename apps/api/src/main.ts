import "./env";
import { RequestMethod } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { browserSecurityMiddleware } from "./common/http";
import { securityHeaders } from "./common/security-headers";
import { healthNoStore } from "./health/health.middleware";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  app.setGlobalPrefix("api/v1", {
    exclude: [{ path: "health", method: RequestMethod.GET }],
  });

  // Order matters: cookies first (middleware + guards read them), then
  // Origin/CSRF checks, before any route handler (v1.2 §12.4).
  app.use(securityHeaders);
  app.use("/health", healthNoStore);
  app.use(cookieParser());
  app.use(browserSecurityMiddleware);

  // Two-origin CORS with credentials (v1.2 §12.4): explicit allowlist,
  // never '*', never Origin reflection.
  app.enableCors({
    origin: [
      process.env.WEB_ORIGIN ?? "http://localhost:5175",
      process.env.ADMIN_ORIGIN ?? "http://localhost:5176",
    ],
    credentials: true,
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`API listening on http://localhost:${port}/api/v1`);
}

void bootstrap();
