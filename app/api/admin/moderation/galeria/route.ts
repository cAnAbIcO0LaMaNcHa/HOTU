/**
 * GET /api/admin/moderation/galeria?slug=... — la galería y la prensa de un artista, para
 * moderar, con las censuradas incluidas.
 *
 * Existe porque el id de una foto no se ve en ningún lado. Las otras piezas censurables se
 * nombran por slug, que está en la URL; una foto se identifica por un entero que no aparece
 * ni en la página ni en la dirección, así que sin esta lectura el panel pediría un id que el
 * moderador no tiene forma de averiguar.
 *
 * DEVUELVE LAS CENSURADAS, al revés que la lectura pública: para levantar una censura hay
 * que poder verla. Una cola que esconde lo que ya bajó no deja deshacer nada.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isModerator } from "@/lib/roles-check";
import { getGaleriaPrensaParaModerar } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  /**
   * La comprobación va acá y no en el lector, igual que en moderation/owner: es una
   * lectura, y un lector con guarda propia invita a llamarlo desde cualquier lado creyendo
   * que se cuida solo.
   */
  if (!(await isModerator(email))) {
    return NextResponse.json({ error: "Solo un moderador" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const slug = (searchParams.get("slug") ?? "").trim();
  if (!slug) return NextResponse.json({ error: "Falta el slug del artista" }, { status: 400 });

  const r = await getGaleriaPrensaParaModerar(slug);
  if (!r.existe) return NextResponse.json({ error: "No encontré ese artista" }, { status: 404 });

  return NextResponse.json({ ok: true, fotos: r.fotos, prensa: r.prensa });
}
