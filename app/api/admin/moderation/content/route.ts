/**
 * PATCH /api/admin/moderation/content — censurar o devolver una pieza.
 *
 * Body: { tipo, clave, accion: "censurar", motivo } | { tipo, clave, accion: "levantar" }
 *
 * Un solo endpoint para los seis tipos de contenido, porque la operación
 * es la misma y lo único que cambia es la tabla. Seis rutas idénticas
 * salvo un nombre serían seis lugares donde arreglar el mismo bug.
 *
 * El permiso lo resuelve lib/moderation-write con isModerator, el mismo
 * que abre /admin. Una sola regla, un solo lugar: esconder el botón es
 * presentación, nunca protección.
 */

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { censurar, levantarCensura } from "@/lib/moderation-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { tipo?: unknown; clave?: unknown; accion?: unknown; motivo?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const accion = body?.accion;
  if (accion !== "censurar" && accion !== "levantar") {
    return NextResponse.json(
      { error: "accion tiene que ser 'censurar' o 'levantar'" },
      { status: 400 }
    );
  }

  const result =
    accion === "censurar"
      ? await censurar(body.tipo, body.clave, body.motivo, email)
      : await levantarCensura(body.tipo, body.clave, email);

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  // Las dos direcciones cambian lo que ve un visitante, así que las dos
  // tienen caché viejo que tirar: censurar saca la pieza del sitio y
  // levantar la devuelve.
  revalidatePath("/", "layout");

  return NextResponse.json({ ok: true, ...result.value });
}
