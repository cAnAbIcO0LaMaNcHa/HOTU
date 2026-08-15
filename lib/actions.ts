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
