import { handlers } from "@/auth";

/**
 * Node runtime, not Edge: the Credentials provider verifies passwords with
 * node:crypto's scrypt (lib/accounts.ts), which the Edge runtime does not
 * provide. Declared explicitly rather than relying on the default so that
 * flipping it later is a deliberate act.
 */
export const runtime = "nodejs";

export const { GET, POST } = handlers;
