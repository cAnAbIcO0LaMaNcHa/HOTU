/**
 * ONE-TIME SETUP ENDPOINT — TANDA 1: profiles, memberships, sales
 * attribution, gigs and likes.
 *
 * Extends user_profiles / artists / collectives, creates the four new
 * tables (artist_collectives, ticket_attributions, artist_gigs,
 * artist_likes) and declares the foreign keys `tickets` never had.
 * Protected by MIGRATE_SECRET. Call it as:
 *   /api/setup-profiles?secret=YOUR_SECRET
 * Safe to re-run: every statement is idempotent.
 *
 * Nothing here drops or rewrites existing data. user_profiles.cedula is
 * deliberately left alone — it gets deprecated in two steps (stop writing
 * it first, clean it up in a later migration), so this file only adds the
 * birth_date column that replaces it.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");

  if (!process.env.MIGRATE_SECRET || secret !== process.env.MIGRATE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL!);
  const log: string[] = [];

  /**
   * Postgres has no `ADD CONSTRAINT IF NOT EXISTS`, so re-running a plain
   * ALTER ... ADD CONSTRAINT would blow up on the second call and break the
   * "safe to re-run" promise every other setup route in this repo keeps.
   * Wrapping it in a DO block and swallowing only duplicate_object gives us
   * that idempotency while still letting real errors (orphan rows, typos)
   * surface as a 500.
   */
  const ensureConstraint = async (label: string, alterStatement: string) => {
    await sql(
      `DO $$ BEGIN ${alterStatement}; EXCEPTION WHEN duplicate_object THEN NULL; END $$`
    );
    log.push(label);
  };

  try {
    // ---------------------------------------------------------------
    // user_profiles — this is THE account table now. One account, three
    // activatable roles; credentials live here and nowhere else.
    // ---------------------------------------------------------------

    // Replaces `cedula`: to check someone is of age the birth date is
    // enough, and a cédula is sensitive data under Ley 1581 de 2012.
    await sql`ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS birth_date DATE`;
    await sql`ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS display_name TEXT`;
    await sql`ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT`;

    // NULL for Google-only accounts — they never set a password.
    await sql`ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS password_hash TEXT`;

    // Google stays and Credentials is added alongside it, so the row has to
    // remember how the account was created. Existing rows predate the
    // Credentials provider, which makes 'google' the correct backfill.
    await sql`
      ALTER TABLE user_profiles
      ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'google'
    `;
    log.push("user_profiles columns ready");

    await ensureConstraint(
      "user_profiles.auth_provider check ready",
      `ALTER TABLE user_profiles
         ADD CONSTRAINT user_profiles_auth_provider_check
         CHECK (auth_provider IN ('google', 'credentials'))`
    );

    // ---------------------------------------------------------------
    // artists — the public DJ profile (EPK).
    // ---------------------------------------------------------------

    // owner_email points at the account that may edit this profile.
    // contact_email is a different thing: the public mail shown in the EPK
    // header. Keeping them apart means a DJ can publish a booking address
    // without exposing the address they log in with.
    await sql`ALTER TABLE artists ADD COLUMN IF NOT EXISTS owner_email TEXT`;
    await sql`ALTER TABLE artists ADD COLUMN IF NOT EXISTS contact_email TEXT`;

    // The other two halves of the EPK header, added after the first pass:
    // the line under the name ("DJ & Productor") and the public booking
    // phone. contact_phone is NOT user_profiles.phone — that one is the
    // account holder's private number, the same distinction owner_email and
    // contact_email already make.
    await sql`ALTER TABLE artists ADD COLUMN IF NOT EXISTS role TEXT`;
    await sql`ALTER TABLE artists ADD COLUMN IF NOT EXISTS contact_phone TEXT`;

    // The code a buyer types at checkout to attribute the sale.
    await sql`ALTER TABLE artists ADD COLUMN IF NOT EXISTS dj_code TEXT`;

    await sql`ALTER TABLE artists ADD COLUMN IF NOT EXISTS bpm_min SMALLINT`;
    await sql`ALTER TABLE artists ADD COLUMN IF NOT EXISTS bpm_max SMALLINT`;

    // Where they are from, as opposed to the existing `city` column, which
    // is where they currently live. Both are shown in "Sobre mí".
    await sql`ALTER TABLE artists ADD COLUMN IF NOT EXISTS origin TEXT`;

    // Cover photo. The avatar is the pre-existing `photo` column.
    await sql`ALTER TABLE artists ADD COLUMN IF NOT EXISTS cover_url TEXT`;

    // Leaf data with no table of its own — unlike artists.sets /
    // top_tracks, these are not duplicating rows that live elsewhere.
    await sql`ALTER TABLE artists ADD COLUMN IF NOT EXISTS socials JSONB NOT NULL DEFAULT '{}'::jsonb`;
    await sql`ALTER TABLE artists ADD COLUMN IF NOT EXISTS rider JSONB NOT NULL DEFAULT '{}'::jsonb`;

    await sql`
      ALTER TABLE artists
      ADD COLUMN IF NOT EXISTS show_sales_to_organizers BOOLEAN NOT NULL DEFAULT TRUE
    `;
    log.push("artists columns ready");

    await ensureConstraint(
      "artists.owner_email fk ready",
      `ALTER TABLE artists
         ADD CONSTRAINT artists_owner_email_fkey
         FOREIGN KEY (owner_email) REFERENCES user_profiles(email)
         ON UPDATE CASCADE ON DELETE SET NULL`
    );

    // Case-insensitive: dj_code is typed by hand at checkout and over
    // WhatsApp, so `camila` and `CAMILA` must not become two codes.
    //
    // The index shipped once under the name ..._lower_idx while indexing
    // upper(). Renaming before the CREATE below covers both cases: on a
    // branch that already ran the old version this renames in place, and on
    // a fresh branch it is a no-op and the CREATE does the work. Without
    // the rename, an already-migrated branch would end up carrying the same
    // index twice under two names.
    await sql`ALTER INDEX IF EXISTS artists_dj_code_lower_idx RENAME TO artists_dj_code_upper_idx`;
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS artists_dj_code_upper_idx
      ON artists (upper(dj_code)) WHERE dj_code IS NOT NULL
    `;
    log.push("artists.dj_code case-insensitive unique index ready");

    // ---------------------------------------------------------------
    // collectives
    // ---------------------------------------------------------------

    await sql`ALTER TABLE collectives ADD COLUMN IF NOT EXISTS owner_email TEXT`;

    // Distinct from the editorial `status` column collectives already has.
    // `status` is visibility (draft/published/archived); this one is whether
    // the collective still meets the 3-DJs/2-residents minimum and may
    // therefore publish new events.
    await sql`
      ALTER TABLE collectives
      ADD COLUMN IF NOT EXISTS status_membership TEXT NOT NULL DEFAULT 'incompleto'
    `;
    log.push("collectives columns ready");

    await ensureConstraint(
      "collectives.status_membership check ready",
      `ALTER TABLE collectives
         ADD CONSTRAINT collectives_status_membership_check
         CHECK (status_membership IN ('activo', 'incompleto'))`
    );

    await ensureConstraint(
      "collectives.owner_email fk ready",
      `ALTER TABLE collectives
         ADD CONSTRAINT collectives_owner_email_fkey
         FOREIGN KEY (owner_email) REFERENCES user_profiles(email)
         ON UPDATE CASCADE ON DELETE SET NULL`
    );

    // ---------------------------------------------------------------
    // tickets — foreign keys the table was created without.
    // RESTRICT everywhere: a ticket is proof of a payment, so nothing it
    // depends on should be deletable out from under it.
    // ---------------------------------------------------------------

    await ensureConstraint(
      "tickets.order_id fk ready",
      `ALTER TABLE tickets
         ADD CONSTRAINT tickets_order_id_fkey
         FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT`
    );

    await ensureConstraint(
      "tickets.order_item_id fk ready",
      `ALTER TABLE tickets
         ADD CONSTRAINT tickets_order_item_id_fkey
         FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE RESTRICT`
    );

    await ensureConstraint(
      "tickets.event_id fk ready",
      `ALTER TABLE tickets
         ADD CONSTRAINT tickets_event_id_fkey
         FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE RESTRICT`
    );

    // ---------------------------------------------------------------
    // artist_collectives — membership history, immutable by design.
    // to_date IS NULL means the link is currently active.
    // ---------------------------------------------------------------

    await sql`
      CREATE TABLE IF NOT EXISTS artist_collectives (
        id SERIAL PRIMARY KEY,
        artist_slug TEXT NOT NULL
          REFERENCES artists(slug) ON UPDATE CASCADE ON DELETE CASCADE,
        collective_slug TEXT NOT NULL
          REFERENCES collectives(slug) ON UPDATE CASCADE ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('residente', 'toca_con')),
        from_date DATE NOT NULL DEFAULT CURRENT_DATE,
        to_date DATE,
        accepted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT artist_collectives_date_range_check
          CHECK (to_date IS NULL OR to_date >= from_date)
      )
    `;
    log.push("table artist_collectives ready");

    // "Residente de — UNO SOLO." Enforced here rather than only in the
    // invite flow, so a race between two invites cannot produce a DJ with
    // two active residencies and split their sales history in half.
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS artist_collectives_one_active_residency_idx
      ON artist_collectives (artist_slug)
      WHERE kind = 'residente' AND to_date IS NULL
    `;

    // Same active link cannot be recorded twice.
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS artist_collectives_active_link_idx
      ON artist_collectives (artist_slug, collective_slug, kind)
      WHERE to_date IS NULL
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS artist_collectives_collective_idx
      ON artist_collectives (collective_slug)
    `;
    log.push("artist_collectives indexes ready");

    // ---------------------------------------------------------------
    // ticket_attributions — who sold this ticket, frozen at sale time.
    //
    // event_id and amount_cop repeat what tickets/order_items already
    // hold. That duplication is the point: the row is a snapshot, and the
    // seller's collective in particular must NEVER be recomputed at read
    // time. If a DJ moves from one collective to another, their old sales
    // have to keep counting for the old one.
    // ---------------------------------------------------------------

    await sql`
      CREATE TABLE IF NOT EXISTS ticket_attributions (
        id SERIAL PRIMARY KEY,
        ticket_id INTEGER NOT NULL UNIQUE
          REFERENCES tickets(id) ON DELETE RESTRICT,
        seller_artist_slug TEXT
          REFERENCES artists(slug) ON UPDATE CASCADE ON DELETE RESTRICT,
        seller_collective_slug TEXT
          REFERENCES collectives(slug) ON UPDATE CASCADE ON DELETE RESTRICT,
        event_id INTEGER NOT NULL
          REFERENCES events(id) ON DELETE RESTRICT,
        amount_cop INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT ticket_attributions_hotu_has_no_collective_check
          CHECK (seller_artist_slug IS NOT NULL OR seller_collective_slug IS NULL)
      )
    `;
    log.push("table ticket_attributions ready");

    await sql`
      CREATE INDEX IF NOT EXISTS ticket_attributions_seller_artist_idx
      ON ticket_attributions (seller_artist_slug)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS ticket_attributions_seller_collective_idx
      ON ticket_attributions (seller_collective_slug)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS ticket_attributions_event_idx
      ON ticket_attributions (event_id)
    `;
    log.push("ticket_attributions indexes ready");

    // ---------------------------------------------------------------
    // artist_gigs — every time the DJ played. Rows sourced from a HOTU
    // lineup carry event_id; gigs played elsewhere are declared by hand.
    // ---------------------------------------------------------------

    await sql`
      CREATE TABLE IF NOT EXISTS artist_gigs (
        id SERIAL PRIMARY KEY,
        artist_slug TEXT NOT NULL
          REFERENCES artists(slug) ON UPDATE CASCADE ON DELETE CASCADE,
        event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
        external_name TEXT,
        flyer_url TEXT,
        venue TEXT,
        city TEXT,
        gig_date DATE NOT NULL,
        district TEXT,
        role TEXT,
        b2b_with TEXT,
        duration_minutes INTEGER,
        source TEXT NOT NULL CHECK (source IN ('hotu', 'declarado')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT artist_gigs_source_shape_check CHECK (
          (source = 'hotu' AND event_id IS NOT NULL) OR
          (source = 'declarado' AND external_name IS NOT NULL)
        )
      )
    `;
    log.push("table artist_gigs ready");

    // Keeps the lineup importer from adding the same gig twice on re-run.
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS artist_gigs_artist_event_idx
      ON artist_gigs (artist_slug, event_id) WHERE event_id IS NOT NULL
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS artist_gigs_artist_date_idx
      ON artist_gigs (artist_slug, gig_date DESC)
    `;
    log.push("artist_gigs indexes ready");

    // ---------------------------------------------------------------
    // artist_likes — follows, not ranking. Composite PK gives us
    // one-like-per-user for free.
    // ---------------------------------------------------------------

    await sql`
      CREATE TABLE IF NOT EXISTS artist_likes (
        artist_slug TEXT NOT NULL
          REFERENCES artists(slug) ON UPDATE CASCADE ON DELETE CASCADE,
        user_email TEXT NOT NULL
          REFERENCES user_profiles(email) ON UPDATE CASCADE ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (artist_slug, user_email)
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS artist_likes_user_email_idx
      ON artist_likes (user_email)
    `;
    log.push("table artist_likes ready");

    const counts = await sql`
      SELECT
        (SELECT COUNT(*) FROM artist_collectives)   AS artist_collectives,
        (SELECT COUNT(*) FROM ticket_attributions)  AS ticket_attributions,
        (SELECT COUNT(*) FROM artist_gigs)          AS artist_gigs,
        (SELECT COUNT(*) FROM artist_likes)         AS artist_likes,
        (SELECT COUNT(*) FROM artists)              AS artists,
        (SELECT COUNT(*) FROM collectives)          AS collectives,
        (SELECT COUNT(*) FROM user_profiles)        AS user_profiles
    `;

    return NextResponse.json({ ok: true, log, counts: counts[0] });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err), log },
      { status: 500 }
    );
  }
}
