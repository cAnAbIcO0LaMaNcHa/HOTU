/**
 * MIGRATION — FASE 2 del renombre: 'casa' pasa a 'residente'.
 *
 *   /api/setup-residentes?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-residentes?secret=YOUR_SECRET
 *
 * ============================================================
 * QUÉ SIGNIFICA ESTO, QUE NO ES SOLO UN NOMBRE
 * ============================================================
 *
 * El núcleo del colectivo deja de llamarse 'casa' y pasa a 'residente'. Y
 * con la fase 2 del código, un residente PUEDE EDITAR el colectivo: bio,
 * foto, portada, género, links, noticias, sets, tracks y eventos.
 *
 * O sea que este valor deja de ser una etiqueta y pasa a ser un PERMISO. Por
 * eso esta migración tiene dos guardas que se niegan a correr, en vez de
 * arreglar lo que encuentren: cuando un valor concede permisos, adivinar es
 * peor que parar.
 *
 * ============================================================
 * GUARDA 1: NI UNA SOLA FILA 'residente' PUEDE EXISTIR ANTES
 * ============================================================
 *
 * La fase 1 dejó el CHECK aceptando 'residente' transitoriamente para que el
 * código viejo no fallara en la ventana entre la migración y el deploy, y
 * setup-cierre-miembros lo retiró después.
 *
 * Si quedó UNA fila 'residente' de esa ventana, esta migración NO PUEDE
 * correr: después del renombre sería indistinguible de un residente del
 * núcleo —el mismo valor, la misma fila— con permiso de edición sobre un
 * colectivo al que nadie la invitó. Y no habría forma de separarla de las
 * legítimas, porque las dos dirían exactamente lo mismo.
 *
 * Así que se cuenta, y si no es cero se devuelve 409 con la lista. Arreglarlo
 * es decidir a mano si cada una era un miembro o un residente, y eso no lo
 * puede resolver una migración.
 *
 * ============================================================
 * GUARDA 2: can_edit SE BORRA, PERO NO A CIEGAS
 * ============================================================
 *
 * artist_collectives.can_edit la creó la migración de ownership y NADIE la
 * lee nunca. Medido: cero filas en true.
 *
 * Se borra en vez de derivarla porque, si se queda, existe un estado que las
 * reglas prohíben: kind='residente' con can_edit=false, o sea un residente
 * que no edita. La decisión fue explícita — todo residente edita, sin permiso
 * aparte— y una columna que puede contradecirla es una columna que algún día
 * la contradice. Es la misma familia que los cuatro estados prohibidos que el
 * reviewer encontró en la republicación: si el schema lo permite, alguien lo
 * produce.
 *
 * Derivar el permiso de `kind` hace que ese estado NO PUEDA EXISTIR.
 *
 * Pero el borrado no va a ciegas: si alguna fila tiene can_edit = true,
 * alguien la usó para algo y esta migración se niega. Un DROP COLUMN no se
 * revierte.
 *
 * ============================================================
 * EL CHECK VUELVE A SER TRANSITORIO, POR LO MISMO QUE EN LA FASE 1
 * ============================================================
 *
 * Acepta los TRES valores —'casa', 'miembro', 'residente'— para que el
 * código viejo, que sigue escribiendo 'casa', no falle entre esta migración
 * y el deploy. setup-cierre-residentes lo retira después.
 *
 * Y si ese cierre ya corrió, ESTA migración lo detecta y no toca nada:
 * reinstalar el de tres valores reabriría la ventana en silencio. Es la
 * cuarta vez en este renombre que una migración vieja podría pelear con una
 * nueva, así que va resuelto de entrada.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VIEJO = "casa";
const NUEVO = "residente";
const MIEMBRO = "miembro";

const CHECK = "artist_collectives_kind_valores_check";
const DEF_TRANSITORIA = `CHECK ((kind = ANY (ARRAY['${VIEJO}'::text, '${MIEMBRO}'::text, '${NUEVO}'::text])))`;
/** Lo que va a dejar setup-cierre-residentes. Si ya está, no se toca nada. */
const DEF_CERRADA = `CHECK ((kind = ANY (ARRAY['${MIEMBRO}'::text, '${NUEVO}'::text])))`;

const IDX_VIEJO = "artist_collectives_one_active_casa_idx";
const IDX_NUEVO = "artist_collectives_one_active_residente_idx";
/**
 * UN SOLO residente activo por artista. Es la decisión de la fase 2: un DJ
 * es residente de UN colectivo y miembro en los demás. El índice se conserva
 * —solo cambia de nombre y de predicado— porque ahora además limita a
 * cuántos colectivos puede editar: uno.
 */
const DEF_IDX = `CREATE UNIQUE INDEX ${IDX_NUEVO} ON public.artist_collectives USING btree (artist_slug) WHERE ((kind = '${NUEVO}'::text) AND (to_date IS NULL))`;

type Estado = {
  porKind: Record<string, number>;
  pendientes: number;
  residentesPrevios: number;
  tieneCanEdit: boolean;
  canEditEnTrue: number;
  checks: string[];
  indices: string[];
  total: number;
};

/** ¿El cierre de la fase 2 ya corrió? Entonces esto no toca nada. */
function yaCerrada(e: Estado): boolean {
  const linea = e.checks.find((x) => x.startsWith(`${CHECK}: `));
  return linea !== undefined && linea.slice(CHECK.length + 2) === DEF_CERRADA;
}

function verificarForma(e: Estado): { ok: boolean; problemas: string[] } {
  const p: string[] = [];

  if (e.pendientes > 0) p.push(`quedan ${e.pendientes} filas con kind='${VIEJO}'`);
  if (e.tieneCanEdit) p.push("artist_collectives.can_edit todavía existe");

  const exacto = (lista: string[], nombre: string, esperado: string, que: string) => {
    const linea = lista.find((x) => x.startsWith(`${nombre}: `));
    if (!linea) {
      p.push(`falta ${que} ${nombre}`);
      return;
    }
    const real = linea.slice(nombre.length + 2);
    if (real !== esperado) {
      p.push(
        `${que} ${nombre} EXISTE PERO tiene otra definición.\n      es:      ${real}\n      debería: ${esperado}`
      );
    }
  };

  // Si el cierre ya corrió, el estado correcto es el cerrado, no el de acá.
  if (!yaCerrada(e)) exacto(e.checks, CHECK, DEF_TRANSITORIA, "el CHECK");

  exacto(e.indices, IDX_NUEVO, DEF_IDX, "el índice");
  if (e.indices.some((x) => x.startsWith(`${IDX_VIEJO}: `))) {
    p.push(`el índice viejo ${IDX_VIEJO} sigue puesto`);
  }
  /** El de vínculo único no lo toca esta migración, pero sin él se repiten. */
  if (!e.indices.some((x) => x.startsWith("artist_collectives_active_link_idx: "))) {
    p.push("falta el índice artist_collectives_active_link_idx");
  }

  return { ok: p.length === 0, problemas: p };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (!process.env.MIGRATE_SECRET || searchParams.get("secret") !== process.env.MIGRATE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = searchParams.get("dryRun") === "1";
  const sql = neon(process.env.DATABASE_URL!);
  const log: string[] = [];

  const estado = async (): Promise<Estado> => {
    const filas = await sql`SELECT kind, COUNT(*)::int AS n FROM artist_collectives GROUP BY 1 ORDER BY 1`;
    const cons = await sql`
      SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'artist_collectives'::regclass AND contype = 'c' ORDER BY conname
    `;
    const idx = await sql`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'artist_collectives' ORDER BY indexname
    `;
    const col = await sql`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'artist_collectives' AND column_name = 'can_edit'
    `;
    const [t] = await sql`SELECT COUNT(*)::int AS n FROM artist_collectives`;
    const porKind = Object.fromEntries(filas.map((f) => [f.kind as string, f.n as number]));

    let canEditEnTrue = 0;
    if (col.length > 0) {
      const [c] = await sql`SELECT COUNT(*)::int AS n FROM artist_collectives WHERE can_edit`;
      canEditEnTrue = c.n as number;
    }

    return {
      porKind,
      pendientes: porKind[VIEJO] ?? 0,
      residentesPrevios: porKind[NUEVO] ?? 0,
      tieneCanEdit: col.length > 0,
      canEditEnTrue,
      checks: cons.map((c) => `${c.conname}: ${c.def}`),
      indices: idx.map((i) => `${i.indexname}: ${i.indexdef}`),
      total: t.n as number,
    };
  };

  try {
    const antes = await estado();

    /* ============ LAS DOS GUARDAS, ANTES DE CUALQUIER DDL ============ */

    /**
     * GUARDA 1. Si el cierre de la fase 1 no corrió, o quedó una fila de la
     * ventana, esto no puede seguir: el renombre volvería indistinguible un
     * 'residente' viejo de un residente del núcleo con permiso de edición.
     *
     * Se comprueba en los DOS caminos, dryRun y real, y devuelve 409 con la
     * lista para que se pueda decidir a mano qué era cada fila.
     */
    /**
     * CÓMO SE SABE SI ESAS FILAS 'residente' SON SOBRANTES O PROPIAS.
     *
     * Este chequeo tenía un bug que apareció al correr la migración DOS
     * VECES, que es justamente para lo que el repo exige correrlas dos
     * veces: después de la primera corrida hay 22 filas 'residente' —las que
     * ella misma renombró— y la segunda las leía como sobrantes de la fase 1
     * y se negaba con 409. La migración no era idempotente.
     *
     * Mirando solo el estado actual las dos son indistinguibles, y el CHECK
     * tampoco ayuda: el transitorio de la fase 1 y el de la fase 2 son el
     * MISMO texto, ('casa','miembro','residente').
     *
     * Lo que sí distingue es can_edit. Esta migración la borra y nada la
     * vuelve a crear, así que su ausencia es una marca de una sola vía:
     *
     *   can_edit EXISTE  -> la fase 2 no corrió -> cualquier 'residente' es
     *                       un sobrante de la ventana de la fase 1. SE NIEGA.
     *   can_edit NO ESTÁ -> la fase 2 ya corrió -> las 'residente' son las
     *                       suyas, y si apareció alguna 'casa' en la ventana
     *                       hay que renombrarla. SIGUE.
     *
     * Es el mismo tipo de marcador que usa la guarda de "ya cerrada": una
     * condición observable en el schema, no una suposición sobre el orden en
     * que alguien corrió las cosas.
     */
    if (antes.residentesPrevios > 0 && antes.tieneCanEdit) {
      const cuales = await sql`
        SELECT id, artist_slug, collective_slug, requested_by, accepted_at, to_date
        FROM artist_collectives WHERE kind = ${NUEVO} ORDER BY id
      `;
      return NextResponse.json(
        {
          ok: false,
          verificado: false,
          error:
            `HAY ${antes.residentesPrevios} fila(s) con kind='${NUEVO}' ANTES del renombre, y esta ` +
            "migración no puede correr. Después de renombrar serían indistinguibles de un " +
            "residente del núcleo, con permiso para editar el colectivo. Decidí a mano si cada " +
            `una era un miembro o un residente —¿la invitó el dueño?— y dejalas en '${MIEMBRO}' ` +
            "o cerralas con to_date antes de volver. Corré setup-cierre-miembros si todavía no corrió.",
          filas: cuales,
          log,
        },
        { status: 409 }
      );
    }

    /**
     * GUARDA 2. can_edit se borra, y un DROP COLUMN no se revierte. Si
     * alguna fila la tiene en true, alguien la usó para algo y hay que
     * mirarlo antes.
     */
    if (antes.tieneCanEdit && antes.canEditEnTrue > 0) {
      return NextResponse.json(
        {
          ok: false,
          verificado: false,
          error:
            `artist_collectives.can_edit tiene ${antes.canEditEnTrue} fila(s) en true, y esta ` +
            "migración la borra. Un DROP COLUMN no se revierte. Mirá esas filas: si de verdad " +
            `hay miembros a los que alguien dio permiso de editar, la fase 2 los convierte en ` +
            `'${NUEVO}' o no, y eso es una decisión, no un borrado.`,
          log,
        },
        { status: 409 }
      );
    }

    if (dryRun) {
      const v = verificarForma(antes);
      log.push(
        v.ok
          ? "SIMULACIÓN: ya está renombrado y con la forma correcta. Correrla no cambiaría nada."
          : `SIMULACIÓN: falta o está mal ${v.problemas.length} cosa(s).`
      );
      for (const x of v.problemas) log.push(`  - ${x}`);
      log.push(
        antes.residentesPrevios === 0
          ? `GUARDA 1 OK: cero filas '${NUEVO}' previas. El renombre no puede confundirse con nada.`
          : `GUARDA 1 OK: hay ${antes.residentesPrevios} filas '${NUEVO}' pero can_edit ya no existe, o sea que son las que ESTA migración renombró. No son sobrantes de la fase 1.`
      );
      log.push(
        antes.tieneCanEdit
          ? `GUARDA 2 OK: can_edit existe con ${antes.canEditEnTrue} filas en true. Se va a borrar.`
          : "GUARDA 2: can_edit ya no existe, nada que borrar."
      );
      log.push(
        `SIMULACIÓN: se renombrarían ${antes.pendientes} filas de '${VIEJO}' a '${NUEVO}'. ` +
          `Las ${antes.porKind[MIEMBRO] ?? 0} de '${MIEMBRO}' no se tocan.`
      );
      log.push(
        `El índice ${IDX_VIEJO} pasa a ${IDX_NUEVO}, único sobre artist_slug: UN residente activo por DJ.`
      );
      log.push(`El CHECK queda TRANSITORIO en los tres valores; lo cierra setup-cierre-residentes.`);
      log.push(`Total de filas: ${antes.total}. No puede cambiar: esto renombra, no crea ni borra.`);
      log.push(`Por kind: ${JSON.stringify(antes.porKind)}.`);
      return NextResponse.json({
        ok: true,
        dryRun: true,
        verificado: v.ok,
        problemas: v.problemas,
        estado: antes,
        log,
      });
    }

    /* ============ SI EL CIERRE YA CORRIÓ, NO SE TOCA NADA ============ */
    if (yaCerrada(antes)) {
      log.push(
        `NO SE TOCÓ NADA: el CHECK ya está CERRADO en ('${MIEMBRO}','${NUEVO}'), o sea que ` +
          "setup-cierre-residentes ya corrió. Reinstalar el de tres valores reabriría la ventana " +
          `y volvería a permitir escribir '${VIEJO}'.`
      );
      const v = verificarForma(antes);
      for (const x of v.problemas) log.push(`  - ${x}`);
      return NextResponse.json({
        ok: true,
        dryRun: false,
        verificado: v.ok,
        problemas: v.problemas,
        renombradas: 0,
        yaCerrada: true,
        antes,
        despues: antes,
        log,
      });
    }

    /**
     * TODO EN UNA TRANSACCIÓN, y el orden es obligatorio.
     *
     * El CHECK viejo no acepta 'residente', así que el UPDATE va después de
     * dropearlo. Y el índice se cambia ADENTRO: entre dropear el de 'casa' y
     * crear el de 'residente' habría una ventana sin la garantía de un solo
     * núcleo activo por DJ, que es justamente la que ahora limita a cuántos
     * colectivos puede editar alguien.
     *
     * El DROP COLUMN va al final: si algo de lo anterior falla, la columna
     * sigue ahí y no se perdió nada.
     */
    const [, actualizadas] = await sql.transaction([
      sql(`ALTER TABLE artist_collectives DROP CONSTRAINT IF EXISTS ${CHECK}`),
      sql`UPDATE artist_collectives SET kind = ${NUEVO} WHERE kind = ${VIEJO} RETURNING id`,
      sql(`ALTER TABLE artist_collectives ADD CONSTRAINT ${CHECK} ${DEF_TRANSITORIA}`),
      sql(`DROP INDEX IF EXISTS ${IDX_VIEJO}`),
      sql(`DROP INDEX IF EXISTS ${IDX_NUEVO}`),
      sql(DEF_IDX),
      sql(`ALTER TABLE artist_collectives DROP COLUMN IF EXISTS can_edit`),
    ]);
    const renombradas = (actualizadas as unknown[]).length;

    log.push(`renombradas ${renombradas} filas de '${VIEJO}' a '${NUEVO}', en una transacción`);
    log.push(`índice ${IDX_NUEVO} creado: UN residente activo por DJ, y por lo tanto un colectivo editable`);
    log.push(
      antes.tieneCanEdit
        ? "can_edit BORRADA: el permiso se deriva de kind, así que 'residente que no edita' deja de poder existir."
        : "can_edit no existía, nada que borrar."
    );
    log.push(
      `CHECK TRANSITORIO en los tres valores: el código viejo puede seguir escribiendo '${VIEJO}' ` +
        "sin fallar. Lo cierra setup-cierre-residentes DESPUÉS del deploy."
    );

    const despues = await estado();
    const v = verificarForma(despues);
    log.push(
      v.ok
        ? `VERIFICADO: cero filas '${VIEJO}', el CHECK transitorio y el índice nuevo con su definición exacta, el índice viejo fuera, y can_edit borrada.`
        : `NO VERIFICADO: ${v.problemas.length} problema(s).`
    );
    for (const x of v.problemas) log.push(`  - ${x}`);

    const problemasDatos: string[] = [];
    if (antes.total !== despues.total) {
      problemasDatos.push(`el total pasó de ${antes.total} a ${despues.total}`);
    }
    if ((antes.porKind[MIEMBRO] ?? 0) !== (despues.porKind[MIEMBRO] ?? 0)) {
      problemasDatos.push(
        `las filas '${MIEMBRO}' pasaron de ${antes.porKind[MIEMBRO] ?? 0} a ${despues.porKind[MIEMBRO] ?? 0}`
      );
    }
    /**
     * ANTES + RENOMBRADAS, no un absoluto.
     *
     * Esto decía `!== renombradas`, o sea que esperaba que TODAS las filas
     * 'residente' fueran las de esta corrida. Pasaba en la primera y fallaba
     * en la segunda, donde renombradas es 0 y las 22 siguen ahí: reportaba
     * "deberían ser 0 y son 22" sobre un estado perfectamente correcto.
     *
     * Es el mismo error que ya apareció en la batería del traspaso, y la
     * misma lección: la pregunta es CUÁNTO CAMBIÓ, no cuánto hay.
     */
    const residenteEsperado = (antes.porKind[NUEVO] ?? 0) + renombradas;
    if ((despues.porKind[NUEVO] ?? 0) !== residenteEsperado) {
      problemasDatos.push(
        `las de '${NUEVO}' deberían ser ${residenteEsperado} (${antes.porKind[NUEVO] ?? 0} + ${renombradas}) y son ${despues.porKind[NUEVO] ?? 0}`
      );
    }
    for (const x of problemasDatos) log.push(`ATENCIÓN: ${x}`);
    if (problemasDatos.length === 0) {
      log.push(`Datos cuadrados: ${JSON.stringify(despues.porKind)}, total ${despues.total}.`);
    }

    return NextResponse.json({
      ok: true,
      dryRun: false,
      verificado: v.ok && problemasDatos.length === 0,
      problemas: [...v.problemas, ...problemasDatos],
      renombradas,
      antes,
      despues,
      log,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), log },
      { status: 500 }
    );
  }
}
