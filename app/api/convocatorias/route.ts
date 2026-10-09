/**
 * POST   /api/convocatorias        — abrir la convocatoria de un evento.
 * PATCH  /api/convocatorias        — cerrarla a mano.
 *
 * Body de POST:  { eventId, cupos?, cierraEn?, nota? }
 * Body de PATCH: { callId, accion: "cerrar" }
 *
 * La ruta hace auth y mira la FORMA del body; quién puede qué y qué significa cada campo lo
 * decide lib/convocatorias-write.ts. Esa división es la del repo entero y existe para que la
 * app móvil pueda usar los mismos endpoints.
 *
 * ============================================================
 * EL COLECTIVO NO VIAJA EN EL BODY, Y ESO ES UNA GARANTÍA
 * ============================================================
 *
 * Abrir una convocatoria toma solo el eventId: el colectivo sale de events.organizer_slug
 * adentro del write path. Si el llamador pudiera decir "este colectivo", podría abrir una
 * convocatoria del evento de otro a nombre del colectivo propio, y la puerta lo dejaría pasar
 * porque está comprobando el colectivo que él mismo nombró.
 *
 * Es el mismo criterio que requestedBy en /api/memberships: nunca se confía en que el llamador
 * diga de parte de quién habla.
 *
 * ============================================================
 * CERRAR ES UN PATCH CON accion, NO UN DELETE
 * ============================================================
 *
 * Una convocatoria SE CIERRA, no se borra: lo que registra es quién convocó y quién se
 * postuló, y eso tiene que seguir teniendo respuesta después. Un DELETE sugeriría lo
 * contrario, y el FK RESTRICT hacia events lo negaría igual.
 *
 * `accion` existe en vez de un PATCH que acepte campos sueltos porque hoy cerrar es lo único
 * que se puede hacer sobre una convocatoria abierta, y un endpoint que acepta "cualquier
 * cambio" invita a que mañana alguien mueva cierra_en por acá sin pasar por la validación de
 * que no quede después del evento.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { abrirConvocatoria, cerrarConvocatoria } from "@/lib/convocatorias-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const eventId = Number(body.eventId);
  if (!Number.isInteger(eventId) || eventId <= 0) {
    return NextResponse.json({ error: "eventId es obligatorio" }, { status: 400 });
  }

  const result = await abrirConvocatoria(
    {
      eventId,
      cupos: body.cupos,
      cierraEn: body.cierraEn,
      nota: body.nota,
      visibilidad: body.visibilidad,
    },
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

  const callId = Number(body.callId);
  if (!Number.isInteger(callId) || callId <= 0) {
    return NextResponse.json({ error: "callId es obligatorio" }, { status: 400 });
  }
  if (body.accion !== "cerrar") {
    return NextResponse.json(
      { error: 'La única accion sobre una convocatoria abierta es "cerrar".' },
      { status: 400 }
    );
  }

  const result = await cerrarConvocatoria(callId, email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  /**
   * Devuelve CUÁNTAS pendientes se rechazaron al cerrar, porque es lo que el dueño necesita
   * saber: cerrar una convocatoria con cinco pendientes adentro les responde a cinco personas
   * de una, y eso no puede pasar sin que la pantalla lo diga.
   */
  return NextResponse.json({ ok: true, rechazadas: result.value.rechazadas });
}
