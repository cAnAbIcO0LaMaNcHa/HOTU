/**
 * ONE-TIME SETUP ENDPOINT — creates the commerce tables (orders, order_items,
 * merch_items, user_profiles) and seeds the merch catalog. Protected by
 * MIGRATE_SECRET. Call it as: /api/setup-commerce?secret=YOUR_SECRET
 * Safe to re-run: every statement is idempotent (IF NOT EXISTS / ON CONFLICT).
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const dynamic = "force-dynamic";

const MERCH_SEED = [
  { slug: "camiseta-hotu", name: "Camiseta HOTU", category: "camiseta", price: 70000 },
  { slug: "saco-hotu", name: "Saco HOTU", category: "saco", price: 120000 },
  { slug: "pasamontanas-hotu", name: "Pasamontañas HOTU", category: "pasamontanas", price: 55000 },
  { slug: "buckethat-hotu", name: "Bucket Hat HOTU", category: "buckethat", price: 65000 },
  { slug: "abanico-hotu", name: "Abanico HOTU", category: "abanico", price: 25000 },
  { slug: "earplugs-hotu", name: "Earplugs HOTU", category: "earplugs", price: 35000 },
  { slug: "arte-hotu", name: "Print de Arte HOTU", category: "arte", price: 90000 },
];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");

  if (!process.env.MIGRATE_SECRET || secret !== process.env.MIGRATE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL!);
  const log: string[] = [];

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS merch_items (
        id SERIAL PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        price_cop INTEGER NOT NULL,
        image TEXT,
        active BOOLEAN NOT NULL DEFAULT true
      )
    `;
    log.push("table merch_items ready");

    await sql`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        user_email TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        payment_provider TEXT DEFAULT 'bold',
        payment_ref TEXT,
        currency TEXT NOT NULL DEFAULT 'COP',
        amount_cop INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        paid_at TIMESTAMPTZ
      )
    `;
    log.push("table orders ready");

    await sql`
      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        item_type TEXT NOT NULL,
        event_id INTEGER REFERENCES events(id),
        ticket_tier TEXT,
        merch_slug TEXT,
        name TEXT NOT NULL,
        unit_price_cop INTEGER NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1
      )
    `;
    log.push("table order_items ready");

    await sql`
      CREATE TABLE IF NOT EXISTS user_profiles (
        email TEXT PRIMARY KEY,
        phone TEXT,
        cedula TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ`;
    log.push("table user_profiles ready");

    await sql`
      CREATE TABLE IF NOT EXISTS audit_log (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        action TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    log.push("table audit_log ready");

    for (const m of MERCH_SEED) {
      await sql`
        INSERT INTO merch_items (slug, name, category, price_cop)
        VALUES (${m.slug}, ${m.name}, ${m.category}, ${m.price})
        ON CONFLICT (slug) DO NOTHING
      `;
    }
    log.push(`merch_items: ${MERCH_SEED.length} seeded`);

    const counts = await sql`
      SELECT
        (SELECT COUNT(*) FROM merch_items) AS merch_items,
        (SELECT COUNT(*) FROM orders) AS orders,
        (SELECT COUNT(*) FROM order_items) AS order_items,
        (SELECT COUNT(*) FROM user_profiles) AS user_profiles,
        (SELECT COUNT(*) FROM audit_log) AS audit_log
    `;

    return NextResponse.json({ ok: true, log, counts: counts[0] });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err), log },
      { status: 500 }
    );
  }
}
