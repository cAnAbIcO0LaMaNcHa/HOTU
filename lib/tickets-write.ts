"use server";

import crypto from "crypto";
import { neon } from "@neondatabase/serverless";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "./admin";

const sql = neon(process.env.DATABASE_URL!);

/** 24-char URL-safe random token — ~144 bits of entropy, unguessable. This
 * is the secret embedded in the QR / verification URL — it has to stay
 * unpredictable even though every ticket also carries a friendly
 * sequential display code (see below). */
function generateTicketCode(): string {
  return crypto.randomBytes(18).toString("base64url");
}

/**
 * Two-letter event prefix derived from the event's id (1 → AA, 2 → AB, ...
 * 26 → AZ, 27 → BA, ...). Deterministic and needs no extra bookkeeping —
 * every event gets a stable, unique prefix the moment it exists.
 */
function eventPrefix(eventId: number): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const idx = eventId - 1;
  const first = letters[Math.floor(idx / 26) % 26];
  const second = letters[idx % 26];
  return first + second;
}

/**
 * Marks an order as paid and issues one individual ticket — each with its
 * own secure code for its own QR, plus a friendly sequential display code
 * like AA0001 — per unit purchased. This is the trigger point that stands
 * in for a real payment webhook until Bold is wired in; once that's live,
 * it can call this same function from the webhook handler instead of an
 * admin button.
 *
 * The display code is only for humans to read off the ticket — it is NOT
 * used to verify entry, on purpose: sequential codes like AA0001, AA0002
 * are easy to guess, so using them as the door's secret would let anyone
 * enumerate valid-looking codes. The QR always encodes the high-entropy
 * ticket_code instead.
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
    if (toCreate <= 0) continue;

    const eventCount = await sql`SELECT COUNT(*) AS n FROM tickets WHERE event_id = ${item.event_id}`;
    let seq = Number(eventCount[0].n);
    const prefix = eventPrefix(item.event_id);

    for (let i = 0; i < toCreate; i++) {
      seq += 1;
      const code = generateTicketCode();
      const displayCode = `${prefix}${String(seq).padStart(4, "0")}`;
      await sql`
        INSERT INTO tickets (ticket_code, display_code, order_id, order_item_id, user_email, event_id, tier)
        VALUES (${code}, ${displayCode}, ${orderId}, ${item.id}, ${order.user_email}, ${item.event_id}, ${item.ticket_tier})
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
