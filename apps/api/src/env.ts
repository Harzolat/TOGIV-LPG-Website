import dotenv from "dotenv";

/**
 * Load local environment before any module captures process.env values.
 *
 * Production hosts inject environment variables directly, so dotenv is a
 * no-op there (it never overrides existing values). Importing this module
 * first ensures local development still works while keeping startup
 * validation in one place.
 */
dotenv.config();

const DEV_TOKEN_PEPPER = "dev-pepper-change-in-production";

function resolveTokenPepper(): string {
  const pepper = process.env.TOKEN_PEPPER;
  if (pepper && pepper.trim().length > 0) return pepper;

  // Fail closed outside an explicitly local/test environment. In particular,
  // an unset NODE_ENV must not silently fall back to the development pepper.
  const local = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
  if (local) return DEV_TOKEN_PEPPER;

  // Never include the value (or any part of it) in the error.
  throw new Error(
    "TOKEN_PEPPER is required outside local development/test environments.",
  );
}

/**
 * Resolved once at startup, after dotenv has loaded. All consumers import
 * this module first, so the value cannot be captured before environment
 * loading has completed.
 */
export const TOKEN_PEPPER = resolveTokenPepper();
