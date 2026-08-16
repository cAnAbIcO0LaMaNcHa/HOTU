"use server";

import { neon } from "@neondatabase/serverless";
import { auth } from "@/auth";
import type { CartItem } from "./commerce-types";

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
 * - Only ever writes to the row matching the caller's own session email -
 *   nobody can update another user's data through this action.
 * - Validates format before writing anything.
 * - The cedula is stored as digits-only; the UI is responsible for masking
 *   it on display (only the owner ever sees their own row anyway).
 */
export async function updateMyProfile(data: { phone: string; cedula: string }): Promise<{ ok: true } | { error: string }> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { error: "not_authenticated" };

  const phone = data.phone.trim().slice(0, 20);
  const cedula = data.cedula.trim().replace(/[^0-9]/g, "").slice(0, 15);

  if (phone && !/^[0-9+()\-\s]{7,20}$/.test(phone)) return { error: "invalid_phone" };
  if (cedula && !/^[0-9]{5,15}$/.test(cedula)) return { error: "invalid_cedula" };

  await sql`
    INSERT INTO user_profiles (email, phone, cedula, updated_at)
    VALUES (${email}, ${phone || null}, ${cedula || null}, now())
    ON CONFLICT (email) DO UPDATE SET phone = ${phone || null}, cedula = ${cedula || null}, updated_at = now()
  `;

  return { ok: true };
}
