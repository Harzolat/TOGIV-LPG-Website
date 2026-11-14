import { SetMetadata } from "@nestjs/common";

/**
 * Explicitly marks a route as public.
 *
 * The global AuthGuard still runs, but a public route bypasses session
 * resolution entirely. Keep this marker limited to routes that intentionally
 * expose unauthenticated access.
 */
export const PUBLIC_KEY = "public_route";

export const Public = () => SetMetadata(PUBLIC_KEY, true);
