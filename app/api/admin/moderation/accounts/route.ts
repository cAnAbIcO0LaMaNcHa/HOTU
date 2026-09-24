/**
 * GET    /api/admin/moderation/accounts?email= — qué se lleva eliminarla.
 * PATCH  /api/admin/moderation/accounts        — banear o devolver.
 * DELETE /api/admin/moderation/accounts        — eliminarla, sin vuelta.
 *
 * PATCH body:  { email, accion: "banear", motivo } | { email, accion: "levantar" }
 * DELETE body: { email, motivo, destinoPerfiles: "desamparar" | "ocultar" }
 *
 * El email va en el body y no en la URL a propósito: un email en un path
 * hay que encodear, se rompe con el signo más, y termina en los logs de
 * acceso de cualquier proxy que haya en el medio. Es un dato de una
 * persona, no un identificador de recurso público. (En el GET no queda
 * más remedio; por eso el GET solo LEE.)
 *
 * ============================================================
 * ESTE DELETE NO PUEDE TOCAR PLATA
 * ============================================================
 *
 * Pasa borrarComercio: false, y el lib rechaza cualquier otra cosa
 * viniendo de este modo. Una cuenta con pedidos o boletas devuelve 409
 * diciendo que lo que corresponde es banearla. La base lo impediría
 * igual —orders y tickets tienen ON DELETE RESTRICT—; esto TRADUCE esa
 * negativa a algo que se pueda leer, en vez de dejar salir un
 * foreign_key_violation crudo.
 */

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { isModerator } from "@/lib/roles-check";
import { banearCuenta, levantarBan } from "@/lib/moderation-write";
import { eliminarCuenta, inventarioDeCuenta } from "@/lib/accounts-delete";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * La vista previa de una eliminación.
 *
 * Existe por lo mismo que la del traspaso: lo que se confirma tiene que
 * haberse podido ver antes. Acá pesa más, porque un traspaso se vuelve a
 * traspasar y esto no se deshace.
 *
 * La comprobación de moderador va acá y no en el lib: es una lectura, y
 * un inventario de cuenta ajena no es algo que se deba poder pedir sin
 * permiso.
 */
export async function GET(request: Request) {
  const session = await auth();
  const actor = session?.user?.email;
  if (!actor) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!(await isModerator(actor))) {
    return NextResponse.json({ error: "Solo un moderador" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const inv = await inventarioDeCuenta(searchParams.get("email") ?? "");
  if (!inv) return NextResponse.json({ error: "No encontré esa cuenta" }, { status: 404 });
  return NextResponse.json({ ok: true, ...inv });
}

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

export async function DELETE(request: Request) {
  const session = await auth();
  const actor = session?.user?.email;
  if (!actor) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { email?: unknown; motivo?: unknown; destinoPerfiles?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const destinoPerfiles = body.destinoPerfiles;
  if (destinoPerfiles !== "desamparar" && destinoPerfiles !== "ocultar") {
    return NextResponse.json(
      { error: "destinoPerfiles tiene que ser 'desamparar' u 'ocultar'" },
      { status: 400 }
    );
  }

  /**
   * borrarComercio: false, escrito acá y NO configurable desde el body.
   *
   * Es la línea que separa este camino de la limpieza pre-lanzamiento. Si
   * viniera del request, un día alguien lo mandaría en true desde una
   * consola y no habría nada que lo frenara salvo la segunda guarda del
   * lib, que existe justamente porque esta podría fallar.
   */
  const r = await eliminarCuenta(
    body.email,
    body.motivo,
    { destinoPerfiles, borrarComercio: false },
    actor,
    "normal"
  );
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  // Se fue un dueño y quizá se censuraron perfiles: cambia lo que ve todo el mundo.
  revalidatePath("/", "layout");

  return NextResponse.json({ ok: true, ...r.value });
}
