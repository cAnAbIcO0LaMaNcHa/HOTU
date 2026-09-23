/**
 * GET   /api/collectives/[slug]/owner — a quién se le puede ceder.
 * PATCH /api/collectives/[slug]/owner — cederlo. Body: { email }
 *
 * El GET devuelve SOLO los miembros del colectivo con cuenta, y solo a
 * su dueño. No es una lista de cuentas de HOTU: ofrecer eso filtraría el
 * email de cada usuario a cualquier dueño de colectivo.
 *
 * Que un moderador le pase un colectivo ajeno a un tercero es otra cosa
 * y vive en /api/admin/moderation/owner, donde exige motivo y queda
 * escrito.
 */

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { cederColectivo, getCandidatosCesion } from "@/lib/collectives-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Solo el dueño ve la lista. La comprobación es directa contra
 *  owner_email y no canEditCollective: ceder no es editar. */
async function esElDueno(slug: string, email: string): Promise<boolean> {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT 1 FROM collectives
    WHERE slug = ${slug} AND lower(owner_email) = lower(${email})
  `;
  return rows.length > 0;
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { slug } = await params;
  if (!(await esElDueno(slug, email))) {
    return NextResponse.json({ error: "Solo su dueño" }, { status: 403 });
  }

  return NextResponse.json({ ok: true, candidatos: await getCandidatosCesion(slug) });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const { slug } = await params;
  const r = await cederColectivo(slug, body.email, email);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  // Cambia quién ve el panel de administración de ese colectivo.
  revalidatePath("/", "layout");
  return NextResponse.json({ ok: true, ...r.value });
}
