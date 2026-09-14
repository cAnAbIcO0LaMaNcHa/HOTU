/**
 * This route no longer adds members.
 *
 * Adding somebody outright contradicted the model: a membership only counts
 * with both sides agreeing, and a collective cannot list a DJ who never
 * said yes (tanda 3, §3). Inviting goes through POST /api/memberships with
 * requestedBy "collective", which is the same endpoint a DJ uses to apply —
 * one pending row either way, differing only in who started it.
 *
 * DELETE lives one level down, at members/[artistSlug]: closing a
 * membership is still the collective's call and needs no handshake.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Los miembros ya no se agregan directo. Usá POST /api/memberships con requestedBy 'collective' para invitar; el DJ tiene que aceptar.",
    },
    { status: 410 }
  );
}
