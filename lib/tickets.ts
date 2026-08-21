import { neon } from "@neondatabase/serverless";
import { auth } from "@/auth";
import { toISODate } from "./db";
import type { DistrictId } from "./districts";

const sql = neon(process.env.DATABASE_URL!);

export type TicketStatus = "valid" | "checked_in" | "cancelled";

export type TicketInstance = {
  id: number;
  ticketCode: string;
  displayCode: string | null;
  eventId: number;
  eventTitle: string;
  eventDate: string;
  venue: string;
  city: string;
  district: DistrictId;
  tier: "normal" | "vip";
  status: TicketStatus;
  checkedInAt: string | null;
  createdAt: string;
};

/**
 * Every individual ticket the signed-in user owns (one row per unit
 * purchased — buying 2x VIP produces two separate tickets here, each with
 * its own QR). This is what powers /perfil/tiquetes.
 */
export async function getMyTicketInstances(): Promise<TicketInstance[]> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return [];

  const rows = await sql`
    SELECT t.id, t.ticket_code, t.display_code, t.tier, t.status, t.checked_in_at, t.created_at,
           e.id AS event_id, e.title, e.event_date, e.venue, e.city, e.district
    FROM tickets t
    JOIN events e ON e.id = t.event_id
    WHERE t.user_email = ${email} AND t.status != 'cancelled'
    ORDER BY e.event_date DESC, t.id ASC
  `;
  return rows.map((r) => ({
    id: r.id,
    ticketCode: r.ticket_code,
    displayCode: r.display_code,
    eventId: r.event_id,
    eventTitle: r.title,
    eventDate: toISODate(r.event_date),
    venue: r.venue,
    city: r.city,
    district: r.district as DistrictId,
    tier: r.tier,
    status: r.status,
    checkedInAt: r.checked_in_at,
    createdAt: r.created_at,
  }));
}

export type TicketDetail = TicketInstance & {
  flyerUrl: string | null;
};

/**
 * A single ticket by its secret code — but only ever returned to its own
 * owner. Guessing/enumerating another person's code isn't enough to see
 * their ticket; the session's email has to match too (defense in depth on
 * top of the code itself being a high-entropy secret).
 *
 * Also brings back the event's flyer_url, if the event has one set — the
 * detail page uses it as the ticket's background. Falls back to null
 * until events get an admin field to set it.
 */
export async function getMyTicketByCode(code: string): Promise<TicketDetail | null> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;

  const rows = await sql`
    SELECT t.id, t.ticket_code, t.display_code, t.tier, t.status, t.checked_in_at, t.created_at,
           e.id AS event_id, e.title, e.event_date, e.venue, e.city, e.district, e.flyer_url
    FROM tickets t
    JOIN events e ON e.id = t.event_id
    WHERE t.ticket_code = ${code} AND t.user_email = ${email}
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    ticketCode: r.ticket_code,
    displayCode: r.display_code,
    eventId: r.event_id,
    eventTitle: r.title,
    eventDate: toISODate(r.event_date),
    venue: r.venue,
    city: r.city,
    district: r.district as DistrictId,
    tier: r.tier,
    status: r.status,
    checkedInAt: r.checked_in_at,
    createdAt: r.created_at,
    flyerUrl: r.flyer_url,
  };
}

export type VerificationTicket = {
  id: number;
  ticketCode: string;
  displayCode: string | null;
  tier: "normal" | "vip";
  status: TicketStatus;
  checkedInAt: string | null;
  eventTitle: string;
  eventDate: string;
  venue: string;
  city: string;
};

/**
 * Public read for the door-staff verification page — deliberately has no
 * ownership check (whoever is scanning at the door isn't the ticket
 * holder). Doesn't return the buyer's email or any personal data, only
 * what's needed to confirm the ticket at the door.
 */
export async function getTicketForVerification(code: string): Promise<VerificationTicket | null> {
  const rows = await sql`
    SELECT t.id, t.ticket_code, t.display_code, t.tier, t.status, t.checked_in_at,
           e.title, e.event_date, e.venue, e.city
    FROM tickets t
    JOIN events e ON e.id = t.event_id
    WHERE t.ticket_code = ${code}
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    ticketCode: r.ticket_code,
    displayCode: r.display_code,
    tier: r.tier,
    status: r.status,
    checkedInAt: r.checked_in_at,
    eventTitle: r.title,
    eventDate: toISODate(r.event_date),
    venue: r.venue,
    city: r.city,
  };
}
