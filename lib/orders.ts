import { neon } from "@neondatabase/serverless";
import { auth } from "@/auth";
import type { MerchItem, OrderRecord, Trophy } from "./commerce-types";
import type { DistrictId } from "./districts";

const sql = neon(process.env.DATABASE_URL!);

export async function getMerchCatalog(): Promise<MerchItem[]> {
  const rows = await sql`SELECT * FROM merch_items WHERE active = true ORDER BY category, name`;
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    category: r.category,
    priceCop: r.price_cop,
    image: r.image ?? undefined,
  }));
}

export async function getMyOrders(): Promise<OrderRecord[]> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return [];

  const orders = await sql`SELECT * FROM orders WHERE user_email = ${email} ORDER BY created_at DESC`;
  const result: OrderRecord[] = [];
  for (const o of orders) {
    const items = await sql`SELECT * FROM order_items WHERE order_id = ${o.id}`;
    result.push({
      id: o.id,
      status: o.status,
      amountCop: o.amount_cop,
      currency: o.currency,
      createdAt: o.created_at,
      paidAt: o.paid_at,
      items: items.map((i) => ({
        itemType: i.item_type,
        name: i.name,
        unitPriceCop: i.unit_price_cop,
        quantity: i.quantity,
        ticketTier: i.ticket_tier,
      })),
    });
  }
  return result;
}

export async function getMyTrophies(): Promise<Trophy[]> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return [];

  const rows = await sql`
    SELECT DISTINCT e.id, e.title, e.event_date, e.district
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN events e ON e.id = oi.event_id
    WHERE o.user_email = ${email} AND o.status = 'paid' AND oi.item_type = 'ticket'
    ORDER BY e.event_date DESC
  `;
  return rows.map((r) => ({
    eventId: r.id,
    eventTitle: r.title,
    eventDate: String(r.event_date),
    district: r.district as DistrictId,
  }));
}
