/**
 * DEV-ONLY SEED — the fixture the tanda 1 features are developed against:
 * three accounts with real password hashes, the OTU collective with two
 * residents and one ally, and a set of sales on event 4 whose attributions
 * cover every shape the rules allow.
 *
 * Call it as: /api/seed-test?secret=YOUR_SECRET
 * Safe to re-run: every write is keyed and idempotent.
 *
 * This route REFUSES to run unless NODE_ENV is "development", i.e. only
 * under `npm run dev` on localhost. That check is what keeps it off the
 * production database: Next sets NODE_ENV itself and ignores any value in
 * .env files, so a pulled Vercel env cannot switch it on. VERCEL_ENV and
 * VERCEL are useless as a guard here — `vercel env pull` writes them into
 * .env.local, so locally they already read as production.
 *
 * All fixture data is namespaced: emails end in @test.hotu.local, artist
 * slugs start with "test-", orders are keyed by a SEED- payment_ref. No
 * real cedula or phone number is ever invented — phones follow the
 * +57 300 000 00XX reserved pattern from the project doc.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import crypto from "node:crypto";
import { hashPassword } from "@/lib/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The event every seeded sale is attributed against. */
const EVENT_ID = 4;

/** Simple on purpose — these are throwaway local accounts. */
const TEST_PASSWORD = "test1234";

const ACCOUNTS = [
  { email: "artista@test.hotu.local", name: "Camila Test", phone: "+57 300 000 0001" },
  { email: "colectivo@test.hotu.local", name: "OTU Test", phone: "+57 300 000 0002" },
  { email: "usuario@test.hotu.local", name: "Usuario Test", phone: "+57 300 000 0003" },
] as const;

const ARTISTS = [
  {
    slug: "test-camila",
    name: "Camila Test",
    djCode: "CAMILA",
    ownerEmail: "artista@test.hotu.local",
    kind: "residente" as const,
  },
  {
    slug: "test-pedro",
    name: "Pedro Test",
    djCode: "PEDRO",
    ownerEmail: null,
    kind: "residente" as const,
  },
  {
    slug: "test-luna",
    name: "Luna Test",
    djCode: "LUNA",
    ownerEmail: null,
    kind: "toca_con" as const,
  },
];

/**
 * One entry per seeded order. `seller` null means the buyer used no code,
 * so the sale belongs to HOTU — and its collective must be null too, which
 * is exactly what the ticket_attributions CHECK enforces.
 *
 * The last entry is the interesting one: Luna sells, but she is only an
 * ally of OTU, never a resident. "Toca con" carries no money, so her sale
 * is attributed to her and to no collective at all.
 */
const SALES = [
  { ref: "SEED-A", seller: "test-camila", collective: "otu", tier: "normal", price: 30000, qty: 3 },
  { ref: "SEED-B", seller: "test-pedro", collective: "otu", tier: "vip", price: 50000, qty: 2 },
  { ref: "SEED-C", seller: null, collective: null, tier: "normal", price: 30000, qty: 2 },
  { ref: "SEED-D", seller: "test-luna", collective: null, tier: "normal", price: 30000, qty: 1 },
];

/** Same scheme as lib/tickets-write.ts: 1 -> AA, 2 -> AB, ... */
function eventPrefix(eventId: number): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const idx = eventId - 1;
  return letters[Math.floor(idx / 26) % 26] + letters[idx % 26];
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");

  if (!process.env.MIGRATE_SECRET || secret !== process.env.MIGRATE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      {
        error: "Seed refused: this route only runs under `npm run dev` (NODE_ENV=development).",
        nodeEnv: process.env.NODE_ENV ?? null,
      },
      { status: 403 }
    );
  }

  const sql = neon(process.env.DATABASE_URL!);
  const log: string[] = [];

  // Surfaced in the response so the caller can see which Neon branch this
  // actually hit, rather than trusting that .env.local says what they think.
  let endpoint = "unknown";
  try {
    endpoint = new URL(process.env.DATABASE_URL!).host.split(".")[0];
  } catch {
    /* keep "unknown" */
  }

  try {
    // --- accounts -------------------------------------------------
    // These are the only rows in the whole seed that carry a password.
    // birth_date replaces cedula (Ley 1581); cedula is never written.
    const passwordHash = await hashPassword(TEST_PASSWORD);

    for (const acc of ACCOUNTS) {
      await sql`
        INSERT INTO user_profiles
          (email, display_name, phone, birth_date, password_hash, auth_provider, consent_at, updated_at)
        VALUES
          (${acc.email}, ${acc.name}, ${acc.phone}, DATE '1995-03-14',
           ${passwordHash}, 'credentials', now(), now())
        ON CONFLICT (email) DO UPDATE SET
          display_name  = EXCLUDED.display_name,
          phone         = EXCLUDED.phone,
          birth_date    = EXCLUDED.birth_date,
          password_hash = EXCLUDED.password_hash,
          auth_provider = 'credentials',
          updated_at    = now()
      `;
    }
    log.push(`${ACCOUNTS.length} test accounts ready (password: ${TEST_PASSWORD})`);

    // --- artists --------------------------------------------------
    for (const a of ARTISTS) {
      await sql`
        INSERT INTO artists
          (slug, name, genre, district, city, bio, joined_at,
           dj_code, owner_email, contact_email, origin, bpm_min, bpm_max, status)
        VALUES
          (${a.slug}, ${a.name}, 'psytrance', 'D07', 'Bogotá',
           'Perfil de prueba para desarrollo. No es una persona real.',
           DATE '2026-01-15',
           ${a.djCode}, ${a.ownerEmail}, ${a.ownerEmail}, 'Bogotá', 138, 150, 'published')
        ON CONFLICT (slug) DO UPDATE SET
          name        = EXCLUDED.name,
          dj_code     = EXCLUDED.dj_code,
          owner_email = EXCLUDED.owner_email,
          bpm_min     = EXCLUDED.bpm_min,
          bpm_max     = EXCLUDED.bpm_max
      `;
    }
    log.push(`${ARTISTS.length} test artists ready (dj_code: ${ARTISTS.map((a) => a.djCode).join(", ")})`);

    // --- OTU ------------------------------------------------------
    await sql`
      INSERT INTO collectives
        (slug, name, type, sector, bio, district, owner_email, status, status_membership)
      VALUES
        ('otu', 'OTU', 'LOCAL', 'Bogotá',
         'Colectivo de prueba para desarrollo. No es un colectivo real.',
         'D07', 'colectivo@test.hotu.local', 'published', 'incompleto')
      ON CONFLICT (slug) DO UPDATE SET
        name        = EXCLUDED.name,
        owner_email = EXCLUDED.owner_email,
        district    = EXCLUDED.district
    `;
    log.push("collective otu ready");

    // --- EPK content for test-camila ------------------------------
    // Only Camila gets sets, tracks and gigs. Pedro and Luna are left
    // deliberately bare so the "empty section" behaviour has something to
    // be tested against: a visitor should see no heading at all on their
    // profiles, and their owner should see the prompt instead.
    for (const s of [
      { slug: "test-set-01", title: "OTU Warehouse · Closing Set", duration: "1H 45M", date: "2026-08-26" },
      { slug: "test-set-02", title: "Sabana Sunrise", duration: "2H 10M", date: "2026-06-22" },
    ]) {
      await sql`
        INSERT INTO dj_sets (slug, title, artist_name, artist_slug, district, duration, recorded_at, url, status)
        VALUES (${s.slug}, ${s.title}, 'Camila Test', 'test-camila', 'D07',
                ${s.duration}, ${s.date}::date, '#', 'published')
        ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, artist_slug = EXCLUDED.artist_slug
      `;
    }

    for (const t of [
      { slug: "test-track-01", title: "Frecuencia Cero", date: "2026-07-14" },
      { slug: "test-track-02", title: "Ruido Blanco", date: "2026-04-02" },
      { slug: "test-track-03", title: "Señal Perdida", date: "2026-01-20" },
    ]) {
      await sql`
        INSERT INTO tracks (slug, title, artist_name, artist_slug, district, released_at, url, status)
        VALUES (${t.slug}, ${t.title}, 'Camila Test', 'test-camila', 'D07',
                ${t.date}::date, '#', 'published')
        ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, artist_slug = EXCLUDED.artist_slug
      `;
    }
    log.push("dj_sets + tracks ready for test-camila");

    // One gig off a HOTU lineup and one declared elsewhere, so the carousel
    // shows both shapes and the CHECK on artist_gigs is exercised.
    const gigs = [
      {
        eventId: EVENT_ID,
        externalName: null,
        venue: null,
        city: null,
        date: "2026-08-26",
        source: "hotu" as const,
      },
      {
        eventId: null,
        externalName: "Bodega Norte · Aniversario",
        venue: "Bodega Norte",
        city: "Chía",
        date: "2026-05-10",
        source: "declarado" as const,
      },
    ];
    for (const g of gigs) {
      const existing = g.eventId
        ? await sql`SELECT 1 FROM artist_gigs WHERE artist_slug = 'test-camila' AND event_id = ${g.eventId}`
        : await sql`SELECT 1 FROM artist_gigs WHERE artist_slug = 'test-camila' AND external_name = ${g.externalName}`;
      if (existing.length > 0) continue;
      await sql`
        INSERT INTO artist_gigs
          (artist_slug, event_id, external_name, venue, city, gig_date, district, role, duration_minutes, source)
        VALUES
          ('test-camila', ${g.eventId}, ${g.externalName}, ${g.venue}, ${g.city},
           ${g.date}::date, 'D07', 'Solo', 90, ${g.source})
      `;
    }
    log.push("artist_gigs ready (1 hotu + 1 declarado)");

    // --- memberships ----------------------------------------------
    // The partial unique indexes make this naturally idempotent, but the
    // explicit guard keeps the re-run from raising instead of no-op'ing.
    for (const a of ARTISTS) {
      const existing = await sql`
        SELECT 1 FROM artist_collectives
        WHERE artist_slug = ${a.slug} AND collective_slug = 'otu'
          AND kind = ${a.kind} AND to_date IS NULL
      `;
      if (existing.length > 0) continue;
      await sql`
        INSERT INTO artist_collectives
          (artist_slug, collective_slug, kind, from_date, accepted_at)
        VALUES (${a.slug}, 'otu', ${a.kind}, DATE '2026-01-15', now())
      `;
    }
    log.push("artist_collectives ready (2 residentes + 1 aliado)");

    // --- recalculate status_membership ----------------------------
    // The rule, applied rather than assumed: 3+ DJs of whom 2+ are
    // residents. Counted DISTINCT because one artist could hold both an
    // active 'residente' and an active 'toca_con' row and must not count
    // twice toward the minimum.
    const [counts] = await sql`
      SELECT
        COUNT(DISTINCT artist_slug)::int AS djs,
        COUNT(DISTINCT artist_slug) FILTER (WHERE kind = 'residente')::int AS residentes
      FROM artist_collectives
      WHERE collective_slug = 'otu' AND to_date IS NULL
    `;
    const membership = counts.djs >= 3 && counts.residentes >= 2 ? "activo" : "incompleto";
    await sql`
      UPDATE collectives SET status_membership = ${membership} WHERE slug = 'otu'
    `;
    log.push(
      `otu recalculated: ${counts.djs} DJs / ${counts.residentes} residentes -> ${membership}`
    );

    // --- sales ----------------------------------------------------
    // payment_ref is the idempotency key: a seeded order is created once
    // and found by its ref on every later run.
    const [eventRow] = await sql`SELECT district FROM events WHERE id = ${EVENT_ID}`;
    if (!eventRow) throw new Error(`event ${EVENT_ID} not found`);
    const districtNum = String(eventRow.district ?? "D00").replace(/^D/, "");
    const prefix = eventPrefix(EVENT_ID);

    let ticketsCreated = 0;
    let attributionsCreated = 0;

    for (const sale of SALES) {
      const amount = sale.price * sale.qty;

      let [order] = await sql`SELECT id FROM orders WHERE payment_ref = ${sale.ref}`;
      if (!order) {
        [order] = await sql`
          INSERT INTO orders
            (user_email, kind, status, payment_provider, payment_ref, amount_cop, paid_at)
          VALUES
            ('usuario@test.hotu.local', 'ticket', 'paid', 'bold', ${sale.ref}, ${amount}, now())
          RETURNING id
        `;
      }

      let [item] = await sql`
        SELECT id, quantity FROM order_items
        WHERE order_id = ${order.id} AND item_type = 'ticket'
      `;
      if (!item) {
        [item] = await sql`
          INSERT INTO order_items
            (order_id, item_type, event_id, ticket_tier, name, unit_price_cop, quantity)
          VALUES
            (${order.id}, 'ticket', ${EVENT_ID}, ${sale.tier},
             'TADA · Miércoles de Techno', ${sale.price}, ${sale.qty})
          RETURNING id, quantity
        `;
      }

      // Same top-up logic as markOrderPaid: only mint the tickets that are
      // missing, so a partial previous run completes instead of doubling.
      const [have] = await sql`
        SELECT COUNT(*)::int AS n FROM tickets WHERE order_item_id = ${item.id}
      `;
      for (let i = have.n; i < sale.qty; i++) {
        const [seqRow] = await sql`
          SELECT COUNT(*)::int AS n FROM tickets WHERE event_id = ${EVENT_ID}
        `;
        const displayCode = `HOTU-${districtNum}-${prefix}${String(seqRow.n + 1).padStart(4, "0")}`;
        await sql`
          INSERT INTO tickets
            (ticket_code, display_code, order_id, order_item_id, user_email, event_id, tier)
          VALUES
            (${crypto.randomBytes(18).toString("base64url")}, ${displayCode},
             ${order.id}, ${item.id}, 'usuario@test.hotu.local', ${EVENT_ID}, ${sale.tier})
        `;
        ticketsCreated++;
      }

      // One attribution per ticket, frozen. seller_collective_slug is
      // written from the SALES table, never derived from the artist's
      // membership at read time — that is the whole point of the column.
      const ticketRows = await sql`
        SELECT id FROM tickets WHERE order_item_id = ${item.id} ORDER BY id
      `;
      for (const t of ticketRows) {
        const res = await sql`
          INSERT INTO ticket_attributions
            (ticket_id, seller_artist_slug, seller_collective_slug, event_id, amount_cop)
          VALUES
            (${t.id}, ${sale.seller}, ${sale.collective}, ${EVENT_ID}, ${sale.price})
          ON CONFLICT (ticket_id) DO NOTHING
          RETURNING id
        `;
        attributionsCreated += res.length;
      }
    }
    log.push(`sales ready: ${ticketsCreated} tickets created, ${attributionsCreated} attributions created`);

    const [summary] = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM user_profiles WHERE password_hash IS NOT NULL) AS accounts_with_password,
        (SELECT COUNT(*)::int FROM artists WHERE slug LIKE 'test-%') AS test_artists,
        (SELECT COUNT(*)::int FROM artist_collectives WHERE collective_slug = 'otu' AND to_date IS NULL) AS otu_members,
        (SELECT status_membership FROM collectives WHERE slug = 'otu') AS otu_status,
        (SELECT COUNT(*)::int FROM collectives WHERE status_membership = 'incompleto') AS collectives_incompleto,
        (SELECT COUNT(*)::int FROM tickets WHERE event_id = ${EVENT_ID}) AS tickets_event,
        (SELECT COUNT(*)::int FROM ticket_attributions) AS attributions,
        (SELECT COALESCE(SUM(amount_cop), 0)::int FROM ticket_attributions WHERE seller_collective_slug = 'otu') AS otu_cop,
        (SELECT COALESCE(SUM(amount_cop), 0)::int FROM ticket_attributions WHERE seller_artist_slug IS NULL) AS hotu_cop
    `;

    return NextResponse.json({ ok: true, endpoint, event: EVENT_ID, log, summary });
  } catch (err) {
    return NextResponse.json(
      { ok: false, endpoint, error: err instanceof Error ? err.message : String(err), log },
      { status: 500 }
    );
  }
}
