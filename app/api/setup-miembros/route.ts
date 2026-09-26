/**
 * MIGRATION — FASE 1 del renombre: 'residente' pasa a 'miembro'.
 *
 *   /api/setup-miembros?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-miembros?secret=YOUR_SECRET
 *
 * ============================================================
 * QUÉ CAMBIA Y QUÉ NO
 * ============================================================
 *
 * artist_collectives.kind tiene hoy dos valores:
 *
 *   'casa'      — el núcleo del colectivo. UNO SOLO por DJ.
 *   'residente' — el vínculo general. Varios a la vez.
 *
 * Esta migración renombra SOLO el segundo: 'residente' -> 'miembro'. Son
 * los DJ que tocan con el colectivo y colaboran con la marca, y no editan
 * nada.
 *
 * 'casa' NO SE TOCA ACÁ. La fase 2 —otro día, y solo cuando esta esté en
 * producción y verificada— lo renombra a 'residente', que es el nombre que
 * queda libre justamente por este paso. Hacer las dos a la vez significaría
 * que durante la ventana la palabra 'residente' quiere decir dos cosas
 * distintas según qué fila mires.
 *
 * ============================================================
 * EL ORDEN ES OBLIGATORIO, Y NO ES EL QUE PARECE
 * ============================================================
 *
 * El CHECK que hay hoy es kind IN ('casa','residente'). O sea que un
 * UPDATE a 'miembro' LO VIOLA: no se puede escribir el valor nuevo
 * mientras la guarda vieja esté puesta.
 *
 * Así que los tres pasos van en UNA sola transacción y en este orden:
 *
 *   1. DROP del CHECK viejo.
 *   2. UPDATE de las filas.
 *   3. ADD del CHECK nuevo.
 *
 * Sueltos —y cada sql del driver HTTP de Neon es su propio request— hay
 * dos ventanas malas: entre 1 y 2 la tabla acepta cualquier valor, y entre
 * 2 y 3 también. Si el paso 3 falla, la tabla queda sin guarda, que es
 * peor que no haber corrido nada. Es el mismo razonamiento que el swap del
 * renombre de la tanda 3, y este archivo copia ese patrón a propósito.
 *
 * ============================================================
 * LA GUARDA DEL BACKFILL ES EL VALOR VIEJO, Y ESO SÍ ES IDEMPOTENTE
 * ============================================================
 *
 * WHERE kind = 'residente' — un valor que esta migración NUNCA escribe.
 * Se consume una vez y no se recrea, así que la segunda corrida encuentra
 * cero filas y no toca nada.
 *
 * Es exactamente lo contrario del patrón prohibido del repo: ahí la guarda
 * era un valor que la propia migración ponía por default, y cualquier fila
 * nueva volvía a matchear el WHERE. Acá el código, después de esto,
 * escribe 'miembro'; nada vuelve a nacer 'residente'.
 *
 * Y el UPDATE lleva RETURNING para poder decir CUÁNTAS filas tocó. Sin
 * eso, "la segunda corrida no hace nada" es una afirmación y no una
 * medición.
 *
 * ============================================================
 * LOS ÍNDICES NO SE TOCAN, Y ESTÁ MEDIDO
 * ============================================================
 *
 * artist_collectives_one_active_casa_idx está predicado en kind='casa', que
 * esta fase no cambia. Y artist_collectives_active_link_idx es único sobre
 * (artist_slug, collective_slug, kind): renombrar un valor no puede crear
 * una colisión, porque 'miembro' no existía antes, así que ninguna fila
 * nueva cae encima de otra.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VIEJO = "residente";
const NUEVO = "miembro";
const CHECK_VIEJO = "artist_collectives_kind_casa_check";
/**
 * NOMBRE NUEVO Y LIBRE, y la primera elección era un bug grave.
 *
 * Había puesto "artist_collectives_kind_check", que es exactamente el
 * OLD_CHECK de setup-membership-kinds. Esa migración se re-corre como todas,
 * y su rama de "ya estaba migrado" hace DROP de su OLD_CHECK y ADD de su
 * NEW_CHECK con los valores viejos — en dos requests SUELTOS, sin
 * transacción. O sea: habría dropeado ESTA guarda, su ADD habría fallado con
 * check_violation por las filas nuevas, y la tabla se quedaba SIN NINGÚN
 * CHECK. Exactamente el estado que el repo describe como peor que no haber
 * corrido nada.
 *
 * Con un nombre libre, las dos migraciones no se pisan. Y además
 * setup-membership-kinds queda neutralizada en el mismo commit: su trabajo
 * de renombre está hecho para siempre y ya no toca constraints.
 *
 * La fase 2 vuelve a hacer swap sobre este mismo nombre, que por eso no
 * nombra ningún valor.
 */
const CHECK_NUEVO = "artist_collectives_kind_valores_check";
/**
 * EL CHECK ACEPTA TRES VALORES, Y ESO ES TRANSITORIO A PROPÓSITO.
 *
 * Sin esto hay una ventana entre la migración en main y el deploy del
 * código: el código VIEJO sigue escribiendo 'residente', y un CHECK de dos
 * valores lo rechazaría. En esa ventana nadie podría aceptar una invitación
 * de miembro — corta, pero real, y la regla del repo es que la transición
 * nunca deja una página peor que antes.
 *
 * Con 'residente' tolerado el orden deja de importar: la migración puede
 * correr antes del deploy sin romper nada, y el UPDATE de abajo se lleva
 * puestas las filas que existan cada vez que se re-corra.
 *
 * ============================================================
 * PERO TIENE QUE CERRARSE ANTES DE LA FASE 2. NO ES OPCIONAL.
 * ============================================================
 *
 * La fase 2 renombra 'casa' a 'residente', y ahí 'residente' pasa a
 * significar el NÚCLEO del colectivo, CON permiso de edición. Una fila
 * 'residente' vieja que se cuele en esta ventana y sobreviva sin renombrar
 * no quedaría como un dato raro: quedaría como un residente del núcleo,
 * con permiso para editar el colectivo, sin que nadie lo haya invitado.
 *
 * Un valor transitorio que no se cierra se convierte en un permiso.
 *
 * Por eso hay una migración de CIERRE —setup-cierre-miembros— que corre
 * DESPUÉS del deploy del código: renombra lo que haya quedado y deja el
 * CHECK solo en los dos valores buenos. Y la migración de la fase 2 se
 * NIEGA a correr si encuentra una sola fila 'residente'.
 */
const TRANSITORIO = "residente";
const DEF_NUEVO = `CHECK ((kind = ANY (ARRAY['casa'::text, '${NUEVO}'::text, '${TRANSITORIO}'::text])))`;

/**
 * LA DEFINICIÓN QUE DEJA EL CIERRE, y por qué esta migración la reconoce.
 *
 * setup-cierre-miembros retira el valor transitorio y deja el CHECK en dos
 * valores. Si después de eso alguien re-corre ESTA migración —y el
 * protocolo del repo es correr las migraciones dos veces, así que va a
 * pasar— volvería a instalar el CHECK de tres valores y REABRIRÍA la
 * ventana: 'residente' pasaría a ser escribible otra vez, en silencio, sin
 * que nadie lo haya pedido.
 *
 * Y eso no es un detalle cosmético: la fase 2 convierte 'residente' en el
 * núcleo con permiso de edición, y su guarda es que no exista ninguna fila
 * con ese valor. Reabrir el transitorio es reabrir el camino a un residente
 * del núcleo que nadie invitó.
 *
 * Es la tercera vez en este mismo renombre que una migración vieja pelea
 * con una nueva —antes fueron setup-membership-kinds y setup-profiles—, así
 * que acá se resuelve de entrada: si el cierre ya corrió, esta migración lo
 * detecta y NO toca nada.
 */
const DEF_CERRADA = `CHECK ((kind = ANY (ARRAY['casa'::text, '${NUEVO}'::text])))`;

type Estado = {
  porKind: Record<string, number>;
  pendientes: number;
  checks: string[];
  indices: string[];
  total: number;
};

/** ¿El cierre de fase 1 ya corrió? Entonces esta migración no toca nada. */
function yaCerrada(e: Estado): boolean {
  const linea = e.checks.find((x) => x.startsWith(`${CHECK_NUEVO}: `));
  return linea !== undefined && linea.slice(CHECK_NUEVO.length + 2) === DEF_CERRADA;
}

function verificarForma(e: Estado): { ok: boolean; problemas: string[] } {
  const p: string[] = [];

  if (e.pendientes > 0) p.push(`quedan ${e.pendientes} filas con kind='${VIEJO}'`);

  /**
   * Si el cierre ya corrió, el estado CORRECTO es el cerrado, no el de
   * esta migración. Verificar contra DEF_NUEVO ahí reportaría un problema
   * que no existe y empujaría a alguien a "arreglarlo" reabriendo la
   * ventana.
   */
  if (yaCerrada(e)) return { ok: p.length === 0, problemas: p };

  const linea = e.checks.find((x) => x.startsWith(`${CHECK_NUEVO}: `));
  if (!linea) p.push(`falta el CHECK ${CHECK_NUEVO}`);
  else {
    const real = linea.slice(CHECK_NUEVO.length + 2);
    if (real !== DEF_NUEVO) {
      p.push(
        `el CHECK ${CHECK_NUEVO} EXISTE PERO tiene otra definición.\n      es:      ${real}\n      debería: ${DEF_NUEVO}`
      );
    }
  }
  if (e.checks.some((x) => x.startsWith(`${CHECK_VIEJO}: `))) {
    p.push(`el CHECK viejo ${CHECK_VIEJO} sigue puesto`);
  }

  /**
   * Los dos índices tienen que seguir EXISTIENDO. Esta migración no los
   * toca, así que si desaparecieron fue por otra cosa — y sin el de la
   * casa, un DJ podría tener dos núcleos.
   */
  for (const idx of [
    "artist_collectives_one_active_casa_idx",
    "artist_collectives_active_link_idx",
  ]) {
    if (!e.indices.some((x) => x.startsWith(`${idx}: `))) p.push(`falta el índice ${idx}`);
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
    const [t] = await sql`SELECT COUNT(*)::int AS n FROM artist_collectives`;
    const porKind = Object.fromEntries(filas.map((f) => [f.kind as string, f.n as number]));
    return {
      porKind,
      pendientes: porKind[VIEJO] ?? 0,
      checks: cons.map((c) => `${c.conname}: ${c.def}`),
      indices: idx.map((i) => `${i.indexname}: ${i.indexdef}`),
      total: t.n as number,
    };
  };

  try {
    const antes = await estado();

    if (dryRun) {
      const v = verificarForma(antes);
      log.push(
        v.ok
          ? "SIMULACIÓN: ya está renombrado y con la forma correcta. Correrla no cambiaría nada."
          : `SIMULACIÓN: falta o está mal ${v.problemas.length} cosa(s).`
      );
      for (const x of v.problemas) log.push(`  - ${x}`);
      log.push(
        `SIMULACIÓN: se renombrarían ${antes.pendientes} filas de '${VIEJO}' a '${NUEVO}'. ` +
          `Las ${antes.porKind.casa ?? 0} de 'casa' NO se tocan: eso es la fase 2.`
      );
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

    /**
     * SI EL CIERRE YA CORRIÓ, ESTA MIGRACIÓN NO HACE NADA.
     *
     * Ver DEF_CERRADA arriba: seguir adelante reinstalaría el CHECK de tres
     * valores y reabriría la ventana en silencio. Se sale temprano y con
     * ok:true, porque no hay nada roto — hay algo que ya avanzó más.
     */
    if (yaCerrada(antes)) {
      log.push(
        `NO SE TOCÓ NADA: el CHECK ya está CERRADO en ('casa','${NUEVO}'), o sea que ` +
          "setup-cierre-miembros ya corrió. Reinstalar el de tres valores reabriría la " +
          `ventana y volvería a permitir escribir '${TRANSITORIO}', que es exactamente lo ` +
          "que la fase 2 no puede tolerar."
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

    let renombradas = 0;
    if (antes.pendientes > 0) {
      /**
       * LOS TRES PASOS, ATÓMICOS. Ver la cabecera: el UPDATE no puede
       * correr con la guarda vieja puesta, y dejar la tabla sin guarda
       * entre dos requests es el modo de falla que no se cierra si el
       * tercero revienta.
       */
      const [, actualizadas] = await sql.transaction([
        sql(`ALTER TABLE artist_collectives DROP CONSTRAINT IF EXISTS ${CHECK_VIEJO}`),
        sql`UPDATE artist_collectives SET kind = ${NUEVO} WHERE kind = ${VIEJO} RETURNING id`,
        sql(`ALTER TABLE artist_collectives DROP CONSTRAINT IF EXISTS ${CHECK_NUEVO}`),
        sql(`ALTER TABLE artist_collectives ADD CONSTRAINT ${CHECK_NUEVO} ${DEF_NUEVO}`),
      ]);
      renombradas = (actualizadas as unknown[]).length;
      log.push(`renombradas ${renombradas} filas de '${VIEJO}' a '${NUEVO}', en una transacción`);
    } else {
      /**
       * Ya estaba renombrado. Igual se RE-AFIRMA la guarda: una corrida
       * que murió entre el DROP y el ADD dejaría la tabla sin CHECK, y
       * eso no se detecta contando filas.
       */
      await sql.transaction([
        sql(`ALTER TABLE artist_collectives DROP CONSTRAINT IF EXISTS ${CHECK_VIEJO}`),
        sql(`ALTER TABLE artist_collectives DROP CONSTRAINT IF EXISTS ${CHECK_NUEVO}`),
        sql(`ALTER TABLE artist_collectives ADD CONSTRAINT ${CHECK_NUEVO} ${DEF_NUEVO}`),
      ]);
      log.push(`guarda activa: no había filas '${VIEJO}', no se renombró nada. CHECK re-afirmado.`);
    }

    /**
     * Y se dropea el índice muerto de la tanda 1.
     *
     * setup-profiles crea artist_collectives_one_active_residency_idx con
     * predicado kind=residente, y setup-membership-kinds lo dropea porque
     * quedó superseded. Pero setup-profiles se re-corre y lo VUELVE a crear:
     * después de esta fase su predicado no matchea ninguna fila, y después
     * de la fase 2 —cuando residente pase a significar el núcleo— se
     * activaría solo, imponiendo una regla por accidente y desde una
     * migración de otra tanda. Se dropea acá para que el estado sea
     * determinista sin importar en qué orden se re-corran.
     */
    await sql(`DROP INDEX IF EXISTS artist_collectives_one_active_residency_idx`);

    const despues = await estado();
    const v = verificarForma(despues);
    log.push(
      v.ok
        ? `VERIFICADO: cero filas '${VIEJO}' AHORA, el CHECK TRANSITORIO de tres valores con su definición exacta, el viejo fuera, y los dos índices en pie. ` +
          `OJO: el CHECK todavía TOLERA '${TRANSITORIO}' para que el código viejo no falle en la ventana. Lo cierra setup-cierre-miembros DESPUÉS del deploy, y sin ese cierre la fase 2 se niega a correr.`
        : `NO VERIFICADO: ${v.problemas.length} problema(s).`
    );
    for (const x of v.problemas) log.push(`  - ${x}`);

    /**
     * El total NO puede cambiar: esto renombra un valor, no crea ni borra
     * filas. Y las de 'casa' tampoco: si se movieron, el UPDATE tocó lo
     * que no debía.
     */
    const casaAntes = antes.porKind.casa ?? 0;
    const casaDespues = despues.porKind.casa ?? 0;
    const problemasDatos: string[] = [];
    if (antes.total !== despues.total) {
      problemasDatos.push(`el total pasó de ${antes.total} a ${despues.total}`);
    }
    if (casaAntes !== casaDespues) {
      problemasDatos.push(`las filas 'casa' pasaron de ${casaAntes} a ${casaDespues}`);
    }
    if ((despues.porKind[NUEVO] ?? 0) !== (antes.porKind[NUEVO] ?? 0) + renombradas) {
      problemasDatos.push(
        `las de '${NUEVO}' no cuadran: ${antes.porKind[NUEVO] ?? 0} + ${renombradas} != ${despues.porKind[NUEVO] ?? 0}`
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
