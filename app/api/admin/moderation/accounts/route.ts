/**
 * PATCH /api/admin/moderation/accounts — banear o devolver una cuenta.
 *
 * Body: { email, accion: "banear", motivo } | { email, accion: "levantar" }
 *
 * El email va en el body y no en la URL a propósito: un email en un path
 * hay que encodear, se rompe con el signo más, y termina en los logs de
 * acceso de cualquier proxy que haya en el medio. Es un dato de una
 * persona, no un identificador de recurso público.
 */

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { banearCuenta, levantarBan } from "@/lib/moderation-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const session = await auth();
  const actor = session?.user?.email;
  if (!actor) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { email?: unknown; accion?: unknown; motivo?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const accion = body?.accion;
  if (accion !== "banear" && accion !== "levantar") {
    return NextResponse.json(
      { error: "accion tiene que ser 'banear' o 'levantar'" },
      { status: 400 }
    );
  }

  const result =
    accion === "banear"
      ? await banearCuenta(body.email, body.motivo, actor)
      : await levantarBan(body.email, actor);

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  // Banear esconde el contenido de esa cuenta y levantar lo devuelve:
  // las dos cambian lo que ve un visitante.
  revalidatePath("/", "layout");

  return NextResponse.json({ ok: true, ...result.value });
}
