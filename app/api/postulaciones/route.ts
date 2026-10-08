/**
 * POST  /api/postulaciones  — el DJ se postula.
 * PATCH /api/postulaciones  — resolverla: aceptar, rechazar, retirar o cancelar.
 *
 * Body de POST:  { callId, artistSlug, mensaje, disponibilidad }
 * Body de PATCH: { appId, accion, motivo? }
 *
 * ============================================================
 * UN SOLO PATCH PARA LAS CUATRO ACCIONES, Y NO CUATRO RUTAS
 * ============================================================
 *
 * Las cuatro escriben la MISMA fila y se excluyen entre sí: una postulación se resuelve una
 * vez. Cuatro endpoints serían cuatro copias de la misma lectura y de la misma puerta, y la
 * exclusión mutua pasaría a depender de que los cuatro la comprueben igual.
 *
 * Quién puede cada una NO lo decide esta ruta, y es la mitad que importa:
 *
 *   aceptar, rechazar, cancelar  — el DUEÑO del colectivo (puedeAdministrarColectivo)
 *   retirar                      — el DJ, dueño del perfil de artista
 *
 * Cada función del write path comprueba la suya. La ruta solo traduce la palabra a la llamada,
 * así que no hay una segunda definición de quién puede qué que pueda desincronizarse.
 *
 * ============================================================
 * EL 409 ES LA RESPUESTA NORMAL, NO UN ERROR RARO
 * ============================================================
 *
 * Todas estas acciones pueden perder una carrera legítima: dos pestañas del panel, o un DJ que
 * se retira justo cuando el dueño acepta. El write path devuelve 409 con un mensaje que dice
 * qué pasó, y la ruta lo pasa tal cual. Un 500 ahí mandaría a buscar un bug que no existe.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  aceptarPostulacion,
  cancelarParticipacion,
  postularse,
  rechazarPostulacion,
  retirarPostulacion,
} from "@/lib/convocatorias-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACCIONES = ["aceptar", "rechazar", "retirar", "cancelar"] as const;
type Accion = (typeof ACCIONES)[number];

async function leerBody(request: Request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await leerBody(request);
  if (!body) return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });

  const callId = Number(body.callId);
  const artistSlug = typeof body.artistSlug === "string" ? body.artistSlug.trim() : "";
  if (!Number.isInteger(callId) || callId <= 0 || !artistSlug) {
    return NextResponse.json(
      { error: "callId y artistSlug son obligatorios" },
      { status: 400 }
    );
  }

  const result = await postularse(
    { callId, artistSlug, mensaje: body.mensaje, disponibilidad: body.disponibilidad },
    email
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ ok: true, id: result.value.id }, { status: 201 });
}

export async function PATCH(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await leerBody(request);
  if (!body) return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });

  const appId = Number(body.appId);
  if (!Number.isInteger(appId) || appId <= 0) {
    return NextResponse.json({ error: "appId es obligatorio" }, { status: 400 });
  }

  const accion = body.accion as Accion;
  if (!ACCIONES.includes(accion)) {
    return NextResponse.json(
      { error: `accion tiene que ser una de: ${ACCIONES.join(", ")}` },
      { status: 400 }
    );
  }

  /**
   * El switch es exhaustivo por construcción: el `never` del default hace que agregar una
   * acción a ACCIONES sin su llamada no compile. Mismo truco que las plantillas de lib/mail.
   */
  switch (accion) {
    case "aceptar": {
      const r = await aceptarPostulacion(appId, email);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      /**
       * `reemplazo` dice si la fila nueva del lineup REEMPLAZÓ una sin resolver que venía del
       * flyer, o si se agregó al final. El dueño lo necesita: en el primer caso el lineup se
       * ve igual que antes y solo quedó vinculado, y en el segundo apareció un nombre nuevo.
       * Sin eso, aceptar parece no haber hecho nada.
       */
      return NextResponse.json({ ok: true, lineupId: r.value.lineupId, reemplazo: r.value.reemplazo });
    }
    case "rechazar": {
      const r = await rechazarPostulacion(appId, body.motivo, email);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      return NextResponse.json({ ok: true });
    }
    case "retirar": {
      const r = await retirarPostulacion(appId, email);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      return NextResponse.json({ ok: true });
    }
    case "cancelar": {
      const r = await cancelarParticipacion(appId, body.motivo, email);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      return NextResponse.json({ ok: true });
    }
    default: {
      const falta: never = accion;
      return NextResponse.json({ error: `accion sin implementar: ${falta}` }, { status: 400 });
    }
  }
}
