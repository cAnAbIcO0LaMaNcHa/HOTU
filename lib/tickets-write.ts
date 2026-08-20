"use server";

import crypto from "crypto";
import { neon } from "@neondatabase/serverless";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "./admin";

const sql = neon(process.env.DATABASE_URL!);

/** 24-char URL-safe random token — ~144 bits of entropy, unguessable. */
function generateTicketCode(): string {
  return crypto.randomBytes(18).toString("base64url");
}

/**
 * Marks an order as paid and issues one individual ticket — each with its
 * own secure code for its own QR — per unit purchased. This is the trigger
 * point that stands in for a real payment webhook until Bold is wired in;
 * once that's live, it can call this same function from the webhook
 * handler instead of an admin button.
 *
 * Idempotent: re-running it for an order that already has tickets won't
 * create duplicates, so it's safe to click twice by accident.
 */
export async function markOrderPaid(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  const orderId = Number(formData.get("orderId"));
  if (!orderId) return;

  const [order] = await sql`SELECT id, user_email FROM orders WHERE id = ${orderId}`;
  if (!order) return;

  await sql`UPDATE orders SET status = 'paid', paid_at = now() WHERE id = ${orderId} AND status != 'paid'`;

  const items = await sql`
    SELECT id, event_id, ticket_tier, quantity FROM order_items
    WHERE order_id = ${orderId} AND item_type = 'ticket'
  `;

  for (const item of items) {
    const existing = await sql`SELECT COUNT(*) AS n FROM tickets WHERE order_item_id = ${item.id}`;
    const already = Number(existing[0].n);
    const toCreate = item.quantity - already;
    for (let i = 0; i < toCreate; i++) {
      const code = generateTicketCode();
      await sql`
        INSERT INTO tickets (ticket_code, order_id, order_item_id, user_email, event_id, tier)
        VALUES (${code}, ${orderId}, ${item.id}, ${order.user_email}, ${item.event_id}, ${item.ticket_tier})
      `;
    }
  }

  revalidatePath("/admin/pedidos");
  revalidatePath("/perfil");
  revalidatePath("/perfil/tiquetes");
}

/**
 * Door check-in — flips a valid ticket to checked_in. Only an admin (door
 * staff account) can do this. A ticket that's already checked_in stays
 * checked_in (the WHERE clause only matches 'valid'), so scanning the same
 * QR twice — say, from a screenshot passed to a second person — doesn't
 * silently let them both in; the second scan just won't update anything,
 * and the verification page will show it was already used.
 */
export async function checkInTicket(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  const code = String(formData.get("code"));
  if (!code) return;

  await sql`
    UPDATE tickets SET status = 'checked_in', checked_in_at = now()
    WHERE ticket_code = ${code} AND status = 'valid'
  `;

  revalidatePath(`/verificar/${code}`);
}
