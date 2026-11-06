import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api/v1");
  app.enableCors({
    origin: [
      process.env.WEB_ORIGIN ?? "http://localhost:5173",
      process.env.ADMIN_ORIGIN ?? "http://localhost:5174",
    ],
    credentials: true,
  });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`API listening on http://localhost:${port}/api/v1`);
}

void bootstrap();
