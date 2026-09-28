/**
 * PATCH /api/admin/events/[id]/organizer — ponerle o sacarle el organizador a un
 * evento.
 *
 * Solo admin. Body: { collectiveSlug: string | null }.
 *
 * `null` DESAMPARA el evento, y es deliberado que se pueda: una asignación
 * equivocada le da la convocatoria de una fiesta al colectivo que no la hizo, y
 * sin vuelta atrás ese error queda para siempre en los números de alguien.
 *
 * La lógica vive en lib/event-organizer-write.ts. Acá solo se autentica, se
 * valida la forma del body, y se revalidan las páginas que cambian.
 */

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { isModerator } from "@/lib/roles-check";
import { asignarOrganizador } from "@/lib/event-organizer-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  /**
   * LA PUERTA ES isModerator Y NO requireAdmin, Y LA DIFERENCIA IMPORTA.
   *
   * En este repo conviven DOS sistemas de admin y no son el mismo conjunto:
   *
   *   requireAdmin()  ->  isAdminEmail: la lista de ADMIN_EMAILS del entorno.
   *   isModerator()   ->  esa lista O el rol SUPER_ADMIN/MODERATOR en user_roles.
   *
   * app/admin/layout.tsx usa isModerator, así que un MODERATOR por rol ABRE
   * /admin/organizadores. Si esta ruta pidiera requireAdmin, ese moderador vería
   * el selector, elegiría un colectivo y recibiría un 403 sin entender por qué —
   * un control que la pantalla ofrece y el server niega.
   *
   * Está MEDIDO: la primera versión de esta ruta usaba requireAdmin y la batería
   * dio 21 MAL con un MODERATOR de rol. La ruta de lineups que ya existía tiene
   * el mismo desajuste, y queda anotado en PROGRESO.md — no se arregla acá porque
   * es otra ruta y merece su propia verificación.
   *
   * El email se pide igual porque el registro necesita saber QUIÉN: una
   * asignación sin autor es justo lo que edit_log existe para que no pase.
   */
  const session = await auth();
  const actorEmail = session?.user?.email;
  if (!actorEmail) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!(await isModerator(actorEmail))) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const { id } = await params;
  const eventId = Number(id);
  if (!Number.isInteger(eventId) || eventId <= 0) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  let body: { collectiveSlug?: unknown };
  try {
    body = (await request.json()) as { collectiveSlug?: unknown };
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  /**
   * AUSENTE Y null NO SON LO MISMO, y acá la diferencia importa más que de
   * costumbre: null es una orden —desamparalo— y ausente es un body mal armado.
   * Tratarlos igual convertiría un PATCH incompleto en un desamparo silencioso.
   */
  if (!("collectiveSlug" in body)) {
    return NextResponse.json(
      { error: "Falta collectiveSlug. Mandá null para sacarle el organizador." },
      { status: 400 }
    );
  }
  const crudo = body.collectiveSlug;
  if (crudo !== null && typeof crudo !== "string") {
    return NextResponse.json(
      { error: "collectiveSlug tiene que ser un slug o null" },
      { status: 400 }
    );
  }
  const slug = crudo === null ? null : crudo.trim();
  if (slug === "") {
    return NextResponse.json(
      { error: "Mandá null para sacarle el organizador, no una cadena vacía" },
      { status: 400 }
    );
  }

  const result = await asignarOrganizador(eventId, slug, actorEmail);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  /**
   * Cambia quién figura como organizador en la agenda y en la página del
   * colectivo —su lista de eventos—, así que se revalida el layout entero. Va acá
   * y no en el lib porque revalidatePath es del request de Next: la app móvil usa
   * el mismo lib y no tiene nada que revalidar.
   */
  revalidatePath("/", "layout");

  return NextResponse.json({ ok: true, ...result.value });
}
