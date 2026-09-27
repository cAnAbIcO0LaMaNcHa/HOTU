/**
 * PATCH /api/residency-offers/[id] — responder o revocar UNA oferta.
 *
 * Body: { action, decision? }
 *
 *   aceptar   el DJ dice que sí. Si ya es residente de otro colectivo, esto
 *             devuelve 200 con un `conflict` y NO TOCA NADA: hay que volver a
 *             llamar con `decision`.
 *   rechazar  el DJ dice que no.
 *   revocar   quien administra el colectivo se arrepiente antes de la respuesta.
 *
 * `decision` es { respuesta: "renunciar", anterior: "miembro" | "salir" } o
 * { respuesta: "rechazar" }. Renunciar cierra la residencia anterior, y hay que
 * decir qué pasa con ese vínculo: quedarse de miembro o salir del todo. Las dos
 * ramas las elige el DJ, ninguna es el default.
 *
 * POR QUÉ ACEPTAR NO MUEVE NADA SOLO: cerrar la residencia de alguien no puede
 * ser el efecto secundario de responder otra cosa. Aunque el afectado sea quien
 * responde, en el momento de apretar "aceptar" nadie le preguntó qué quería que
 * pasara con el colectivo donde está hoy.
 *
 * Los dos lados van por el mismo endpoint porque es el mismo objeto, y quién
 * puede hacer qué lo decide el lib: responder es del DJ, revocar de quien
 * administra el colectivo. Ninguna de las dos se comprueba acá.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  responderOferta,
  revocarOferta,
  type DecisionDeResidencia,
} from "@/lib/residency-offers-write";

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

  let body: { action?: unknown; decision?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  switch (body.action) {
    case "aceptar":
    case "rechazar": {
      const result = await responderOferta(
        id,
        body.action,
        email,
        body.decision as DecisionDeResidencia | undefined
      );
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
      return NextResponse.json({ ok: true, ...(result.value ?? {}) });
    }
    case "revocar": {
      const result = await revocarOferta(id, email);
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
      return NextResponse.json({ ok: true });
    }
    default:
      return NextResponse.json(
        { error: "action must be 'aceptar', 'rechazar' or 'revocar'" },
        { status: 400 }
      );
  }
}
