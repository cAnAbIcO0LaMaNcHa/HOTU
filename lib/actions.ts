"use server";

import { neon } from "@neondatabase/serverless";
import { auth } from "@/auth";
import type { CartItem } from "./commerce-types";
import { encryptField } from "./crypto";

const sql = neon(process.env.DATABASE_URL!);

/**
 * Creates a pending order from the cart. This does NOT charge anything yet -
 * it just reserves the order row so the checkout page can hand off to the
 * payment provider (Bold) once that integration is wired in.
 */
export async function createPendingOrder(items: CartItem[]): Promise<{ orderId: number } | { error: string }> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { error: "not_authenticated" };
  if (items.length === 0) return { error: "empty_cart" };

  const amountCop = items.reduce((sum, it) => sum + it.unitPriceCop * it.quantity, 0);
  const kind = items.every((i) => i.kind === "ticket") ? "ticket" : items.every((i) => i.kind === "merch") ? "merch" : "mixed";

  const [order] = await sql`
    INSERT INTO orders (user_email, kind, status, currency, amount_cop)
    VALUES (${email}, ${kind}, 'pending', 'COP', ${amountCop})
    RETURNING id
  `;

  for (const it of items) {
    if (it.kind === "ticket") {
      await sql`
        INSERT INTO order_items (order_id, item_type, event_id, ticket_tier, name, unit_price_cop, quantity)
        VALUES (${order.id}, 'ticket', ${it.eventId}, ${it.tier}, ${it.eventTitle}, ${it.unitPriceCop}, ${it.quantity})
      `;
    } else {
      await sql`
        INSERT INTO order_items (order_id, item_type, merch_slug, name, unit_price_cop, quantity)
        VALUES (${order.id}, 'merch', ${it.slug}, ${it.name}, ${it.unitPriceCop}, ${it.quantity})
      `;
    }
  }

  return { orderId: order.id };
}

/**
 * Updates the signed-in user's contact phone and cedula (Colombian national ID).
 *
 * Security measures:
 * - Only ever writes to the row matching the caller's own session email.
 * - Validates format before writing anything.
 * - Requires explicit Habeas Data consent (Ley 1581/2012) the first time
 *   phone or cedula is saved; consent, once given, is remembered.
 * - Rate-limited: rejects updates within 3s of the previous one.
 * - The cedula is encrypted at rest (see ./crypto) before it is stored.
 * - Writes an audit_log row (email + action only, never the values).
 * - Never logs the phone or cedula value anywhere.
 */
export async function updateMyProfile(data: {
  phone: string;
  cedula: string;
  consent: boolean;
}): Promise<{ ok: true } | { error: string }> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { error: "not_authenticated" };

  const phone = data.phone.trim().slice(0, 20);
  const cedula = data.cedula.trim().replace(/[^0-9]/g, "").slice(0, 15);

  if (phone && !/^[0-9+()\-\s]{7,20}$/.test(phone)) return { error: "invalid_phone" };
  if (cedula && !/^[0-9]{5,15}$/.test(cedula)) return { error: "invalid_cedula" };

  const existing = await sql`SELECT updated_at, consent_at FROM user_profiles WHERE email = ${email}`;

  if (existing.length > 0) {
    const lastUpdate = new Date(existing[0].updated_at).getTime();
    if (Date.now() - lastUpdate < 3000) return { error: "rate_limited" };
  }

  const hadConsent = existing.length > 0 && !!existing[0].consent_at;
  const needsConsent = (phone || cedula) && !hadConsent;
  if (needsConsent && !data.consent) return { error: "consent_required" };

  const consentAt = hadConsent ? existing[0].consent_at : data.consent ? new Date().toISOString() : null;
  const encryptedCedula = cedula ? encryptField(cedula) : null;

  await sql`
    INSERT INTO user_profiles (email, phone, cedula, consent_at, updated_at)
    VALUES (${email}, ${phone || null}, ${encryptedCedula}, ${consentAt}, now())
    ON CONFLICT (email) DO UPDATE SET
      phone = ${phone || null},
      cedula = ${encryptedCedula},
      consent_at = COALESCE(user_profiles.consent_at, ${consentAt}),
      updated_at = now()
  `;

  await sql`INSERT INTO audit_log (email, action) VALUES (${email}, 'profile_updated')`;

  return { ok: true };
}
