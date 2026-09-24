/**
 * POST /api/admin/cleanup — la limpieza pre-lanzamiento (§8).
 *
 * Body: {
 *   secret,                            // MIGRATE_SECRET, la segunda llave
 *   accion: "vista-previa" | "eliminar",
 *   emails: string[],                  // explícitos, uno por uno
 *   motivo,                            // >= 10 caracteres
 *   destinoPerfiles: "desamparar" | "ocultar"
 * }
 *
 * Existe para una sola cosa: sacar las cuentas de prueba antes de abrir
 * al público. Tiene fecha de vencimiento y se apaga con una variable de
 * entorno, sin tocar código ni desplegar nada.
 *
 * ============================================================
 * TRES LLAVES, Y NINGUNA ALCANZA SOLA
 * ============================================================
 *
 *   1. LIMPIEZA_PRELANZAMIENTO=1   — si falta, esto es un 404. No un 403:
 *                                    la ruta deja de existir, y lo que no
 *                                    existe no se prueba a ver si cede.
 *   2. Sesión de SUPER_ADMIN       — una persona con cuenta, identificada,
 *                                    que queda escrita en el registro.
 *   3. MIGRATE_SECRET en el body   — algo que no viaja en una cookie, así
 *                                    que una sesión robada tampoco basta.
 *
 * Son independientes A PROPÓSITO. La primera es un interruptor con una
 * fecha; la segunda dice QUIÉN; la tercera dice que además hay que tener
 * acceso al entorno. Rotar el secreto no apaga el interruptor y apagar
 * el interruptor no invalida el secreto.
 *
 * Y todas se vuelven a comprobar en lib/accounts-delete.ts. Dos veces lo
 * mismo, porque "esto vive en un archivo aparte, así que el borrado
 * normal no puede llamarlo" es una promesa, no una garantía.
 *
 * ============================================================
 * LA SELECCIÓN ES EXPLÍCITA. SIEMPRE.
 * ============================================================
 *
 * Los emails vienen en una lista, uno por uno. Nunca un patrón, nunca un
 * LIKE '%test%', nunca "las que no tienen contraseña". Un filtro que
 * parece decir "las de prueba" es la forma más común de borrar de más, y
 * acá no hay vuelta atrás: una cuenta de una persona real que se llame
 * testa@... no tiene por qué pagar el costo de un atajo.
 *
 * Por eso la vista previa es un paso obligatorio y no una cortesía: el
 * formulario no deja confirmar hasta haber visto qué se lleva CADA
 * cuenta de la lista.
 */

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { timingSafeEqual } from "node:crypto";
import { auth } from "@/auth";
import { isSuperAdmin } from "@/lib/roles-check";
import { limpiarTexto } from "@/lib/texto";
import {
  eliminarCuenta,
  esDestinoPerfiles,
  inventarioDeCuenta,
  limpiezaHabilitada,
} from "@/lib/accounts-delete";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tope por llamada. Nadie limpia 200 cuentas de una y las mira todas. */
const MAX_CUENTAS = 50;

/**
 * Comparación de largo constante.
 *
 * El `!==` de las migraciones alcanza para una URL que se pega a mano una
 * vez; esto es un POST que alguien podría golpear en un bucle. No cuesta
 * nada cerrarlo y ahorra tener que pensar si importa.
 *
 * El largo se compara aparte porque timingSafeEqual tira si difieren, y
 * ese throw sería en sí mismo el canal que se quiere evitar.
 */
function secretoCorrecto(recibido: string): boolean {
  const esperado = process.env.MIGRATE_SECRET ?? "";
  if (!esperado) return false;
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  /**
   * El interruptor va PRIMERO y responde 404.
   *
   * Antes de mirar sesión, secreto o body: si la limpieza está cerrada,
   * esta ruta no existe. Un 403 confirmaría que existe y está apagada,
   * que es justo lo que no hace falta contarle a nadie.
   */
  if (!limpiezaHabilitada()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const session = await auth();
  const actor = session?.user?.email;
  if (!actor) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!(await isSuperAdmin(actor))) {
    return NextResponse.json(
      { error: "La limpieza pre-lanzamiento es de un SUPER_ADMIN" },
      { status: 403 }
    );
  }

  let body: {
    secret?: unknown;
    accion?: unknown;
    emails?: unknown;
    motivo?: unknown;
    destinoPerfiles?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  if (typeof body.secret !== "string" || !secretoCorrecto(body.secret)) {
    return NextResponse.json({ error: "La clave de migración no coincide" }, { status: 403 });
  }

  const accion = body.accion;
  if (accion !== "vista-previa" && accion !== "eliminar") {
    return NextResponse.json(
      { error: "accion tiene que ser 'vista-previa' o 'eliminar'" },
      { status: 400 }
    );
  }

  /**
   * Los emails: normalizados, sin vacíos y SIN REPETIR.
   *
   * Sin el dedup, mandar dos veces la misma cuenta deja dos filas en el
   * registro —una del borrado y otra de un 404— y el resumen diría que
   * algo falló cuando no falló nada.
   */
  const crudos = Array.isArray(body.emails) ? body.emails : [];
  const emails = [...new Set(crudos.map((e) => limpiarTexto(e).toLowerCase()).filter(Boolean))];
  if (emails.length === 0) {
    return NextResponse.json({ error: "No elegiste ninguna cuenta" }, { status: 400 });
  }
  if (emails.length > MAX_CUENTAS) {
    return NextResponse.json(
      { error: `De a ${MAX_CUENTAS} como mucho, para que se puedan mirar` },
      { status: 400 }
    );
  }

  /* ---------- VISTA PREVIA: no escribe nada ---------- */
  if (accion === "vista-previa") {
    const inventarios = [];
    const noEncontradas: string[] = [];
    for (const email of emails) {
      const inv = await inventarioDeCuenta(email);
      if (inv) inventarios.push(inv);
      else noEncontradas.push(email);
    }
    return NextResponse.json({ ok: true, inventarios, noEncontradas });
  }

  /* ---------- EL BORRADO ---------- */
  const destinoPerfiles = body.destinoPerfiles;
  if (!esDestinoPerfiles(destinoPerfiles)) {
    return NextResponse.json(
      { error: "destinoPerfiles tiene que ser 'desamparar' u 'ocultar'" },
      { status: 400 }
    );
  }

  /**
   * Una cuenta por vez, cada una en su transacción, y si alguna falla
   * las demás siguen.
   *
   * No son un lote: son N decisiones independientes, cada una con su
   * fila en el registro. Abortar las veinte porque la tercera tenía una
   * boleta nueva obligaría a repetir todo y a volver a leer qué se
   * borró; peor, dejaría a quien confirmó sin saber cuáles sí salieron.
   * El resumen dice una por una qué pasó.
   */
  const resultados: Array<{
    email: string;
    ok: boolean;
    error?: string;
    registroId?: number;
    medido?: Record<string, number>;
    registroCompleto?: boolean;
  }> = [];

  for (const email of emails) {
    const r = await eliminarCuenta(
      email,
      body.motivo,
      { destinoPerfiles, borrarComercio: true },
      actor,
      "limpieza"
    );
    resultados.push(
      r.ok
        ? {
            email,
            ok: true,
            registroId: r.value.registroId,
            medido: r.value.medido,
            registroCompleto: r.value.registroCompleto,
          }
        : { email, ok: false, error: r.error }
    );
  }

  const borradas = resultados.filter((r) => r.ok).length;
  if (borradas > 0) {
    // Se fueron perfiles, dueños y quizá censuras: cambia lo que ve todo el mundo.
    revalidatePath("/", "layout");
  }

  return NextResponse.json({
    ok: true,
    borradas,
    fallidas: resultados.length - borradas,
    resultados,
  });
}
