import path from "node:path";
import { defineConfig } from "prisma/config";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, ".env") });

export default defineConfig({
  schema: path.join(__dirname, "prisma", "schema.prisma"),
  migrations: {
    path: path.join(__dirname, "prisma", "migrations"),
  },
  datasource: {
    // Prisma CLI/migrations must use Neon's direct (unpooled) endpoint:
    // PgBouncer transaction mode is unsuitable for schema migrations.
    // The NestJS runtime keeps using the pooled DATABASE_URL (app.module.ts).
    url:
      process.env.DATABASE_URL_UNPOOLED ??
      process.env.DATABASE_URL ??
      "postgresql://user:password@localhost:5432/togiv_lpg?schema=public",
  },
});
