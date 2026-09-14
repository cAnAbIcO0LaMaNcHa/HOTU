/**
 * PATCH /api/memberships/[id] — answer or adjust one membership.
 *
 * Body: { action, kind?, decision?, previous? }
 *
 *   accept   the side that did NOT open the conversation says yes. When
 *            that side is the DJ they also send the kind they chose.
 *   reject   the same side says no. The row closes; the pair can try again.
 *   cancel   the side that DID open it withdraws while still pending.
 *   kind     the DJ sets or changes casa/residente on an accepted link.
 *   casa     the DJ's explicit answer to a home conflict.
 *
 * ASKING FOR 'casa' NEVER MOVES ANYTHING BY ITSELF. When the DJ already
 * has a home, accept and kind both answer 200 with a `conflict` payload
 * listing the options and change nothing. Only a second call — action
 * "casa", carrying decision and previous — actually writes. Closing
 * somebody's home is not a side effect of another request.
 *
 * Who may do what lives in lib/membership-write.ts: an invitation is
 * answered by the artist, an application by the collective, a withdrawal
 * by whoever started it, and only ever the DJ decides about their home.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  acceptMembership,
  cancelMembership,
  chooseKind,
  rejectMembership,
  resolveCasa,
  type CasaDecision,
} from "@/lib/membership-write";
import type { MembershipKind } from "@/lib/collectives-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "id must be a positive integer" }, { status: 400 });
  }

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { action?: unknown; kind?: unknown; decision?: unknown; previous?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  const kind = body.kind as MembershipKind | undefined;

  switch (body.action) {
    case "accept": {
      const result = await acceptMembership(id, kind, email);
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
      return NextResponse.json({ ok: true, ...result.value });
    }
    case "reject": {
      const result = await rejectMembership(id, email);
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
      return NextResponse.json({ ok: true });
    }
    case "cancel": {
      const result = await cancelMembership(id, email);
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
      return NextResponse.json({ ok: true });
    }
    case "kind": {
      if (kind !== "casa" && kind !== "residente") {
        return NextResponse.json(
          { error: "kind must be 'casa' or 'residente'" },
          { status: 400 }
        );
      }
      const result = await chooseKind(id, kind, email);
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
      return NextResponse.json({ ok: true, ...(result.value ?? {}) });
    }
    case "casa": {
      const result = await resolveCasa(
        id,
        { decision: body.decision, previous: body.previous } as CasaDecision,
        email
      );
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
      return NextResponse.json({ ok: true });
    }
    default:
      return NextResponse.json(
        { error: "action must be 'accept', 'reject', 'cancel', 'kind' or 'casa'" },
        { status: 400 }
      );
  }
}
