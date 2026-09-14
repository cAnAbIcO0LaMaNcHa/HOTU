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

/**
 * Artwork for the fixture's cover columns. A real object in the project's
 * public blob store, uploaded through /api/upload, so the seed does not
 * depend on any third-party host staying up.
 */
const FIXTURE_COVER_URL =
  "https://v8xxoqrs7taeo7mv.public.blob.vercel-storage.com/artists/test-camila/track-cover-61Q2qvTj9UUgM9ZNXJle69uAdLpwRP";

const ACCOUNTS = [
  { email: "artista@test.hotu.local", name: "Camila Test", phone: "+57 300 000 0001" },
  { email: "colectivo@test.hotu.local", name: "OTU Test", phone: "+57 300 000 0002" },
  { email: "usuario@test.hotu.local", name: "Usuario Test", phone: "+57 300 000 0003" },
  // The two sides of a membership conversation, so the flow can be driven
  // end to end from a browser without borrowing anybody else's account.
  { email: "aplicante@test.hotu.local", name: "Aplicante Test", phone: "+57 300 000 0004" },
  { email: "duena@test.hotu.local", name: "Dueña Test", phone: "+57 300 000 0005" },
] as const;

const ARTISTS = [
  { slug: "test-camila", name: "Camila Test", djCode: "CAMILA", ownerEmail: "artista@test.hotu.local" },
  { slug: "test-pedro", name: "Pedro Test", djCode: "PEDRO", ownerEmail: null },
  { slug: "test-luna", name: "Luna Test", djCode: "LUNA", ownerEmail: null },
  // Deliberately has NO membership anywhere: the "apply from zero" case.
  { slug: "test-aplicante", name: "Aplicante Test", djCode: "APLICA", ownerEmail: "aplicante@test.hotu.local" },
  // Owns the collective that receives applications.
  { slug: "test-duena", name: "Dueña Test", djCode: "DUENA", ownerEmail: "duena@test.hotu.local" },
];

/** A collective nobody in the fixture belongs to, so an application to it
 *  really starts from nothing — and whose owner is a test account, so the
 *  other side of the conversation can be driven from a browser too. */
const REISEN = {
  slug: "reisen",
  name: "Reisen",
  ownerEmail: "duena@test.hotu.local",
  district: "D05",
};

/**
 * Un venue de prueba (tanda 3, §5).
 *
 * Comparte la tabla `collectives` con los colectivos y se distingue por
 * entity_kind. Existe para que /venues tenga contenido y para ejercitar
 * lo único que un venue tiene y un colectivo no: dirección y aforo.
 *
 * Su dueña es la misma cuenta que ya tiene un colectivo, a propósito: es
 * el caso que demuestra que "uno por cuenta" cuenta por tipo y no en
 * total. Con el bug viejo, esta cuenta no habría podido tener los dos.
 */
const VENUE = {
  slug: "bodega-prueba",
  name: "Bodega Prueba",
  ownerEmail: "duena@test.hotu.local",
  district: "D08",
  address: "Calle 80 # 14 - 11",
  capacity: 400,
};

/**
 * The membership fixture, declared rather than accumulated.
 *
 * Every DJ gets one casa and at least one residencia somewhere else, spread
 * across the collectives that exist, so the two carousels of a press kit
 * both have something in them.
 *
 * One casa per artist, which is the rule the partial unique index enforces
 * — check it by eye before adding a row here: camila/otu, pedro/paramo,
 * luna/subsuelo, dueña/reisen, and the aplicante with none at all.
 *
 * test-aplicante is absent ON PURPOSE. It is the account that applies from
 * zero, and seeding it into anything would destroy the case it exists for.
 */
const MEMBERSHIPS = [
  { artist: "test-camila", collective: "otu", kind: "casa" as const },
  { artist: "test-camila", collective: "hotu-138", kind: "residente" as const },
  { artist: "test-pedro", collective: "paramo-club", kind: "casa" as const },
  { artist: "test-pedro", collective: "otu", kind: "residente" as const },
  { artist: "test-luna", collective: "subsuelo-djs", kind: "casa" as const },
  { artist: "test-luna", collective: "otu", kind: "residente" as const },
  { artist: "test-duena", collective: REISEN.slug, kind: "casa" as const },
  { artist: "test-duena", collective: "chia-underground", kind: "residente" as const },
  // Residencias en el VENUE. Nunca 'casa': un venue no es la casa de
  // nadie, y el write path rechaza los tres caminos que podrían ponerla
  // ahí. Poner 'casa' acá crearía a mano justo el estado que el código
  // impide, y el fixture dejaría de representar algo alcanzable.
  { artist: "test-duena", collective: VENUE.slug, kind: "residente" as const },
  { artist: "test-camila", collective: VENUE.slug, kind: "residente" as const },
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
/**
 * Likes, so "ARTISTAS QUE ME GUSTAN" has something to show.
 *
 * The plain user follows three DJs — that is the case the section exists
 * for. Camila follows one, which proves a DJ's own profile carries the
 * section too. The applicant follows nobody, so the empty state (the
 * section is not rendered at all) stays reachable without editing data.
 */
const LIKES = [
  { email: "usuario@test.hotu.local", artist: "test-camila" },
  { email: "usuario@test.hotu.local", artist: "test-pedro" },
  { email: "usuario@test.hotu.local", artist: "test-luna" },
  { email: "artista@test.hotu.local", artist: "test-luna" },
];

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
        (slug, name, type, sector, bio, district, owner_email, status)
      VALUES
        ('otu', 'OTU', 'LOCAL', 'Bogotá',
         'Colectivo de prueba para desarrollo. No es un colectivo real.',
         'D07', 'colectivo@test.hotu.local', 'published')
      ON CONFLICT (slug) DO UPDATE SET
        name        = EXCLUDED.name,
        owner_email = EXCLUDED.owner_email,
        district    = EXCLUDED.district
    `;
    // The destination for applications. Its owner is a test account, so
    // both halves of the conversation can be driven from a browser.
    await sql`
      INSERT INTO collectives
        (slug, name, type, sector, bio, district, owner_email, status)
      VALUES
        (${REISEN.slug}, ${REISEN.name}, 'LOCAL', 'Bogotá',
         'Colectivo de prueba para desarrollo. Recibe postulaciones. No es un colectivo real.',
         ${REISEN.district}, ${REISEN.ownerEmail}, 'published')
      ON CONFLICT (slug) DO UPDATE SET
        name        = EXCLUDED.name,
        owner_email = EXCLUDED.owner_email,
        district    = EXCLUDED.district
    `;
    log.push("collectives otu y reisen listos");

    // El venue. entity_kind lo separa de los colectivos en TODA lectura;
    // sin esa columna en el INSERT caería en el default y aparecería en
    // /colectivos.
    await sql`
      INSERT INTO collectives
        (slug, name, type, sector, bio, district, owner_email, status,
         entity_kind, address, capacity)
      VALUES
        (${VENUE.slug}, ${VENUE.name}, 'LOCAL', 'Bogotá',
         'Venue de prueba para desarrollo. No es un lugar real.',
         ${VENUE.district}, ${VENUE.ownerEmail}, 'published',
         'venue', ${VENUE.address}, ${VENUE.capacity})
      ON CONFLICT (slug) DO UPDATE SET
        name        = EXCLUDED.name,
        owner_email = EXCLUDED.owner_email,
        entity_kind = EXCLUDED.entity_kind,
        address     = EXCLUDED.address,
        capacity    = EXCLUDED.capacity
    `;
    log.push(`venue ${VENUE.slug} listo (entity_kind='venue', aforo ${VENUE.capacity})`);

    // --- EPK content for test-camila ------------------------------
    // Only Camila gets sets, tracks and gigs. Pedro and Luna are left
    // deliberately bare so the "empty section" behaviour has something to
    // be tested against: a visitor should see no heading at all on their
    // profiles, and their owner should see the prompt instead.
    // Covers, label and manual order are part of the fixture rather than
    // values typed in by hand, so tanda 2's columns survive a re-run and
    // anyone picking the project up sees them populated.
    //
    // The cover is a real file already in the blob store, uploaded through
    // /api/upload. If it is ever deleted from the store the seed will
    // still write the URL and the square will render empty — the column is
    // exercised either way, and pointing at an external host would put a
    // fixture at the mercy of somebody else's uptime.
    for (const s of [
      {
        slug: "test-set-01",
        title: "OTU Warehouse · Closing Set",
        duration: "1H 45M",
        date: "2026-08-26",
        cover: FIXTURE_COVER_URL,
        sortOrder: null,
      },
      {
        slug: "test-set-02",
        title: "Sabana Sunrise",
        duration: "2H 10M",
        date: "2026-06-22",
        cover: null,
        sortOrder: null,
      },
    ]) {
      await sql`
        INSERT INTO dj_sets
          (slug, title, artist_name, artist_slug, district, duration, recorded_at, url, status, cover_url, sort_order)
        VALUES (${s.slug}, ${s.title}, 'Camila Test', 'test-camila', 'D07',
                ${s.duration}, ${s.date}::date, '#', 'published', ${s.cover}, ${s.sortOrder})
        ON CONFLICT (slug) DO UPDATE SET
          title       = EXCLUDED.title,
          artist_slug = EXCLUDED.artist_slug,
          duration    = EXCLUDED.duration,
          cover_url   = EXCLUDED.cover_url,
          sort_order  = EXCLUDED.sort_order
      `;
    }

    // test-track-03 carries sort_order 0 on purpose: it is the OLDEST of
    // the three, so if manual ordering works it appears first, and if it
    // silently stops working it drops to last. A middle position would
    // hide the regression.
    for (const t of [
      {
        slug: "test-track-01",
        title: "Frecuencia Cero",
        date: "2026-07-14",
        cover: FIXTURE_COVER_URL,
        label: "Sello Prueba",
        sortOrder: null,
      },
      {
        slug: "test-track-02",
        title: "Ruido Blanco",
        date: "2026-04-02",
        cover: null,
        label: null,
        sortOrder: null,
      },
      {
        slug: "test-track-03",
        title: "Señal Perdida",
        date: "2026-01-20",
        cover: null,
        label: null,
        sortOrder: 0,
      },
    ]) {
      await sql`
        INSERT INTO tracks
          (slug, title, artist_name, artist_slug, district, released_at, url, status, cover_url, label, sort_order)
        VALUES (${t.slug}, ${t.title}, 'Camila Test', 'test-camila', 'D07',
                ${t.date}::date, '#', 'published', ${t.cover}, ${t.label}, ${t.sortOrder})
        ON CONFLICT (slug) DO UPDATE SET
          title       = EXCLUDED.title,
          artist_slug = EXCLUDED.artist_slug,
          cover_url   = EXCLUDED.cover_url,
          label       = EXCLUDED.label,
          sort_order  = EXCLUDED.sort_order
      `;
    }
    log.push("dj_sets + tracks ready for test-camila (con portada, sello y orden)");

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
    /**
     * Declarative: make the database match MEMBERSHIPS, rather than adding
     * to whatever is already there.
     *
     * CLOSE FIRST, THEN INSERT, and not the other way round. Moving a DJ's
     * casa means there is a moment with two active casas if the insert goes
     * first, and the partial unique index refuses exactly that. The order
     * is not tidiness, it is the only one that works.
     *
     * Only the fixture's own artists are touched. Real memberships are
     * never closed by the seed.
     */
    const fixtureArtists = ARTISTS.map((a) => a.slug);
    let cerrados = 0;
    let abiertos = 0;

    for (const slug of fixtureArtists) {
      const wanted = MEMBERSHIPS.filter((m) => m.artist === slug);
      const live = await sql`
        SELECT id, collective_slug, kind FROM artist_collectives
        WHERE artist_slug = ${slug} AND to_date IS NULL
      `;

      for (const row of live) {
        const keep = wanted.some(
          (w) => w.collective === row.collective_slug && w.kind === row.kind
        );
        if (keep) continue;
        await sql`UPDATE artist_collectives SET to_date = CURRENT_DATE WHERE id = ${row.id}`;
        cerrados++;
      }
    }

    for (const m of MEMBERSHIPS) {
      const existing = await sql`
        SELECT 1 FROM artist_collectives
        WHERE artist_slug = ${m.artist} AND collective_slug = ${m.collective}
          AND kind = ${m.kind} AND to_date IS NULL
      `;
      if (existing.length > 0) continue;
      await sql`
        INSERT INTO artist_collectives
          (artist_slug, collective_slug, kind, from_date, accepted_at, requested_by)
        VALUES (${m.artist}, ${m.collective}, ${m.kind}, DATE '2026-01-15', now(), 'collective')
      `;
      abiertos++;
    }
    log.push(
      `artist_collectives: ${MEMBERSHIPS.length} vínculos del fixture (${abiertos} abiertos, ${cerrados} cerrados en esta corrida). test-aplicante queda sin ninguno a propósito.`
    );

    // No status_membership recalculation any more: tanda 3 (§1.1) removed
    // the 3-DJs/2-residents minimum, so there is no publishable flag left
    // to keep in sync.

    // --- likes ----------------------------------------------------
    // ON CONFLICT DO NOTHING keeps the original created_at, so re-running
    // the seed does not reshuffle the order the user sees.
    let likesCreated = 0;
    for (const l of LIKES) {
      const res = await sql`
        INSERT INTO artist_likes (artist_slug, user_email)
        VALUES (${l.artist}, ${l.email})
        ON CONFLICT (artist_slug, user_email) DO NOTHING
        RETURNING artist_slug
      `;
      if (res.length > 0) likesCreated++;
    }
    log.push(
      `artist_likes: ${LIKES.length} del fixture (${likesCreated} nuevos en esta corrida). test-aplicante no sigue a nadie a propósito.`
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
