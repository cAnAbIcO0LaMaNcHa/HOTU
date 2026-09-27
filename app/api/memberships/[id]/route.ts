/**
 * PATCH /api/memberships/[id] — responder o ajustar UNA membresía.
 *
 * Body: { action, kind? }
 *
 *   accept   el lado que NO abrió la conversación dice que sí.
 *   reject   el mismo lado dice que no. La fila se cierra y el par puede
 *            volver a intentar.
 *   cancel   el lado que SÍ la abrió se arrepiente mientras sigue pendiente.
 *   kind     el DJ RENUNCIA a su residencia y queda de miembro.
 *
 * ============================================================
 * LO QUE ESTA RUTA YA NO PUEDE HACER
 * ============================================================
 *
 * Hasta §8 fase 2 había una acción "casa" y accept aceptaba un kind:'casa':
 * el DJ elegía su propio núcleo. Las dos se fueron, y no por limpieza.
 *
 * 'residente' ahora es PERMISO PARA EDITAR el colectivo. Si esta ruta siguiera
 * dejando elegirlo, cualquier miembro de cualquier colectivo se ascendía solo
 * y salía con permiso de editar un perfil ajeno, con una llamada y sin que el
 * dueño se enterara. El renombre por sí solo no habría tocado este archivo
 * —la palabra queda igual— y ahí estaba el agujero.
 *
 * La residencia se concede: el dueño ofrece y el DJ acepta, en
 * /api/residency-offers. Por acá el DJ solo puede DEJARLA, que no necesita
 * permiso de nadie.
 *
 * Quién puede qué vive en lib/membership-write.ts: una invitación la responde
 * el artista, una postulación el colectivo, un retiro quien lo empezó, y sobre
 * sus propios vínculos decide siempre el DJ.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  acceptMembership,
  cancelMembership,
  chooseKind,
  rejectMembership,
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

  let body: { action?: unknown; kind?: unknown };
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
      /**
       * El kind se pasa tal cual y lo rechaza el lib, en vez de filtrarlo acá.
       * Es a propósito: si la ruta lo descartara en silencio, el DJ recibiría
       * 200 creyendo que quedó residente y se enteraría al no poder editar. El
       * lib contesta 403 explicando dónde está la puerta.
       */
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
      if (kind !== "residente" && kind !== "miembro") {
        return NextResponse.json(
          { error: "kind must be 'residente' or 'miembro'" },
          { status: 400 }
        );
      }
      /**
       * 'residente' pasa la validación de forma y lo rechaza chooseKind con
       * 403. No se atrapa acá con un 400 porque los dos códigos dicen cosas
       * distintas: 400 es "no entendí", y esto se entendió perfecto y no se
       * permite.
       */
      const result = await chooseKind(id, kind, email);
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
      return NextResponse.json({ ok: true });
    }
    default:
      return NextResponse.json(
        { error: "action must be 'accept', 'reject', 'cancel' or 'kind'" },
        { status: 400 }
      );
  }
}
