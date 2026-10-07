/**
 * MIGRATION — convocatorias (§7): un colectivo abre un cupo, los DJs se postulan.
 *
 *   /api/setup-convocatorias?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-convocatorias?secret=YOUR_SECRET
 *
 *   event_calls         — la convocatoria. Una abierta por evento.
 *   event_applications  — la postulación. Una pendiente por DJ y convocatoria.
 *
 * ============================================================
 * DOS TABLAS Y NO UNA
 * ============================================================
 *
 * Son dos ciclos de vida: la convocatoria se abre y se cierra UNA vez; las postulaciones son
 * muchas y cada una se resuelve por separado. Meterlas en una sola obligaría a un jsonb de
 * postulantes, y eso es exactamente la deuda que los tres jsonb de la tanda 2 vinieron a
 * pagar.
 *
 * ============================================================
 * LO QUE ESTA MIGRACIÓN **NO** CREA, PORQUE YA EXISTE
 * ============================================================
 *
 * NO TOCA event_lineup, y eso se midió antes de escribir una línea. Aceptar una postulación
 * va a ser un INSERT ahí, y event_lineup_event_artist_idx ya es UNIQUE (event_id,
 * artist_slug) WHERE artist_slug IS NOT NULL. Esta migración no lo crea pero SÍ lo verifica
 * por definición, porque es la garantía que el código va a dar por sentada.
 *
 * PERO ESA GARANTÍA ES MÁS CHICA DE LO QUE LA PRIMERA VERSIÓN DE ESTE COMENTARIO DECÍA, y la
 * diferencia importa. Decía que "aceptar no puede duplicar la fila" y eso es FALSO: el índice
 * es PARCIAL sobre artist_slug IS NOT NULL, así que NO VE las filas sin resolver.
 *
 * El caso concreto, y no es un borde: el importador de lineups deja filas con raw_name y
 * artist_slug en NULL cuando no encuentra el match. MEDIDO EN DEV: 7 de las 9 filas de
 * event_lineup están así. O sea que el caso sin resolver es LA MAYORÍA.
 *
 * Entonces si el lineup tiene (evento 5, raw_name 'Camila', artist_slug NULL) y se acepta la
 * postulación de Camila, el INSERT de (evento 5, 'Camila', 'camila') NO viola nada —el índice
 * no ve la fila vieja— y el lineup muestra a Camila DOS VECES. Sin error, sin log.
 *
 * LO QUE EL ÍNDICE GARANTIZA es que no haya dos filas RESUELTAS iguales. Nada más. Que no
 * haya una resuelta junto a su versión sin resolver es trabajo del WRITE PATH: tiene que
 * buscar la fila sin resolver con el mismo nombre normalizado —normalizarNombre() ya existe
 * en lib/lineup-import.ts— y REEMPLAZARLA en vez de agregar al lado.
 *
 * Y HAY DOS COLUMNAS DE event_lineup QUE EL WRITE PATH TIENE QUE LLENAR, medidas:
 *   raw_name  es NOT NULL SIN DEFAULT. El INSERT la tiene que dar; lo razonable es el nombre
 *             del artista.
 *   position  es NOT NULL DEFAULT 0, y esa es la trampa callada: si el INSERT la omite, cada
 *             DJ aceptado entra en 0, o sea ARRIBA de todo el lineup importado, porque
 *             event_lineup_event_idx ordena por (event_id, position) y el importador numera
 *             desde 0. No falla: REORDENA. Hay que calcular max(position)+1.
 *
 * Tampoco crea una tabla de notificaciones: el resultado se lee de event_applications, y el
 * aviso se registra en mail_outbox con lib/mail.ts, que ya existe y todavía no tiene
 * proveedor.
 *
 * ============================================================
 * EL CIERRE AUTOMÁTICO VA A ESTAR PARTIDO EN DOS, Y NINGUNA MITAD ES UN CHECK
 * ============================================================
 *
 * EN FUTURO A PROPÓSITO: nada de lo que sigue existe todavía. Grepeado — el único archivo del
 * repo que menciona estas dos tablas es esta migración. Es el diseño acordado, no una
 * descripción de código, y en este repo un comentario en indicativo se lee como una medición.
 *
 * "Cerrada" va a significar dos cosas distintas y conflatearlas es la trampa:
 *
 *   EL PERMISO —¿puedo postularme?— se DERIVARÁ y tiene que ser correcto YA. Va en el WHERE
 *   de la sentencia que inserta: cerrada_en IS NULL AND (cierra_en IS NULL OR cierra_en >
 *   now()) AND el evento no pasó. En el segundo en que pasa cierra_en, postularse se rechaza,
 *   sin esperar ningún cron. Guarda adentro de la sentencia, misma lección que el tope de 12
 *   fotos: atómico no es serializable, pero una guarda en el WHERE no se puede saltar.
 *
 *   EL REGISTRO —cerrada_en escrito y las pendientes rechazadas— puede llegar después, y lo
 *   va a escribir /api/mantenimiento-convocatorias con su propia entrada de cron.
 *
 * Y LO QUE EL DJ VEA TAMBIÉN SE VA A DERIVAR AL LEER, sin escribir: si la convocatoria ya
 * venció por fecha o porque pasó el evento, su postulación pendiente se muestra como
 * "convocatoria cerrada" aunque el cron no haya corrido. Así nunca ve "pendiente" sobre algo
 * que ya no tiene respuesta. Por eso el barrido es cosmética del REGISTRO y no la fuente de
 * verdad de nada que alguien lea.
 *
 * NO SE VA A CERRAR AL LEER, y hay dos razones: un GET que escribe sorprende y dos lectores
 * compiten por cerrar lo mismo; y sobre todo, si nadie lee no se cierra nunca — una
 * convocatoria de un colectivo que nadie visita dejaría sus postulaciones pendientes para
 * siempre, que es justo lo que la decisión de rechazarlas al cerrar vino a evitar.
 *
 * ============================================================
 * cierra_en NO PUEDE SER POSTERIOR AL EVENTO, Y NO PUEDE SER UN CHECK
 * ============================================================
 *
 * Queda dicho para que nadie lo busque como constraint: cierra_en vive en event_calls y la
 * fecha del evento en events, y un CHECK no puede cruzar tablas.
 *
 * Las dos salidas eran denormalizar la fecha del evento acá —una copia que envejece, el mismo
 * error que NO se cometió con el perfil del DJ en la postulación— o validarlo en el write
 * path. Va en el write path, en los dos lados: al abrir la convocatoria, y al editar el
 * evento. Si mueven la fecha del evento ANTES del cierre de una convocatoria abierta,
 * cierra_en se RECORTA al nuevo día en la misma transacción y la respuesta lo informa: un
 * cierre posterior al evento no significa nada, así que recortarlo no pierde información
 * —hace que el dato diga lo que ya es cierto— y rechazar la edición sería negarle al
 * organizador una corrección real para preservar un valor sin sentido.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CALLS = "event_calls";
const APPS = "event_applications";
const TABLAS = [CALLS, APPS] as const;

/** Espacio, tab, CR, LF y espacio duro, con escapes y no literales. */
const BLANCOS = " \t\r\n\u00A0";

/** nombre, tipo esperado, aceptaNull, default esperado (null = ninguno). */
type DefCol = [string, RegExp, boolean, string | null];

const COLUMNAS: Record<string, DefCol[]> = {
  [CALLS]: [
    ["id", /integer/i, false, `nextval('${CALLS}_id_seq'::regclass)`],
    ["event_id", /integer/i, false, null],
    ["collective_slug", /text/i, false, null],
    // NULL = sin tope declarado. Distinto de 0, que sería una convocatoria cerrada escrita mal.
    ["cupos", /integer/i, true, null],
    // NULL = abierta hasta que la cierren a mano o pase el evento.
    ["cierra_en", /timestamp with time zone/i, true, null],
    ["cerrada_en", /timestamp with time zone/i, true, null],
    /**
     * NULL con cerrada_en puesto significa algo preciso: LA CERRÓ EL BARRIDO, no una persona.
     * Es la misma clase de NULL informativo que account_removals.measured.
     */
    ["cerrada_por", /text/i, true, null],
    ["abierta_por", /text/i, true, null],
    ["nota", /text/i, true, null],
    ["creada_en", /timestamp with time zone/i, false, "now()"],
  ],
  [APPS]: [
    ["id", /integer/i, false, `nextval('${APPS}_id_seq'::regclass)`],
    ["call_id", /integer/i, false, null],
    ["artist_slug", /text/i, false, null],
    ["mensaje", /text/i, false, null],
    ["disponibilidad", /text/i, false, null],
    ["resuelta_en", /timestamp with time zone/i, true, null],
    ["resultado", /text/i, true, null],
    ["resuelta_por", /text/i, true, null],
    /**
     * EL MOTIVO SIRVE PARA LAS DOS COSAS, y por eso es una columna y no dos: en un rechazo es
     * OPCIONAL —así se decidió, porque un motivo obligatorio hace que el dueño no cierre
     * postulaciones para no tener que escribirlo— y en una cancelación de participación es
     * OBLIGATORIO. Un CHECK distingue los dos casos; dos columnas habrían dejado una siempre
     * vacía.
     */
    ["motivo", /text/i, true, null],
    /**
     * CANCELAR NO PISA resuelta_en, y es el punto de que sean dos columnas: resuelta_en guarda
     * CUÁNDO SE ACEPTÓ y cancelada_en CUÁNDO SE DESHIZO. Reusar una sola borraría la fecha del
     * acuerdo al deshacerlo, y entonces nadie podría decir cuánto tiempo el DJ estuvo
     * programado — que es justo lo que alguien va a preguntar.
     */
    ["cancelada_en", /timestamp with time zone/i, true, null],
    ["cancelada_por", /text/i, true, null],
    ["creada_en", /timestamp with time zone/i, false, "now()"],
  ],};

const CHECKS: Record<string, Array<[string, string]>> = {
  [CALLS]: [
    /** Cero cupos es una convocatoria cerrada expresada mal. NULL es "sin tope". */
    [`${CALLS}_cupos_check`, "CHECK (((cupos IS NULL) OR (cupos > 0)))"],
    [
      `${CALLS}_nota_check`,
      `CHECK (((nota IS NULL) OR (btrim(nota, '${BLANCOS}'::text) <> ''::text)))`,
    ],
    /**
     * No puede haber quien cerró sin cierre. Al revés SÍ: cerrada_en sin cerrada_por es el
     * barrido, que es un caso legítimo y el más común.
     */
    [
      `${CALLS}_cerrada_coherente_check`,
      "CHECK (((cerrada_por IS NULL) OR (cerrada_en IS NOT NULL)))",
    ],
  ],
  [APPS]: [
    [
      `${APPS}_mensaje_check`,
      `CHECK ((btrim(mensaje, '${BLANCOS}'::text) <> ''::text))`,
    ],
    [
      `${APPS}_disponibilidad_check`,
      `CHECK ((btrim(disponibilidad, '${BLANCOS}'::text) <> ''::text))`,
    ],
    [
      `${APPS}_resultado_valores_check`,
      "CHECK (((resultado IS NULL) OR (resultado = ANY (ARRAY['aceptada'::text, 'rechazada'::text, 'retirada'::text, 'cancelada'::text]))))",
    ],
    /**
     * 'cancelada' ES UN CUARTO VALOR Y NO UN BORRADO, y por eso entra acá y no en el write
     * path: sacar a un DJ ya aceptado del lineup tiene que dejar rastro de que ESTUVO
     * aceptado. Si en cambio se borrara la fila o se la volviera 'rechazada', el histórico
     * diría que nunca entró, y el DJ —que ya lo había anunciado— no tendría dónde ver qué
     * pasó.
     *
     * Y NO TOCA resuelta_en, que sigue guardando CUÁNDO SE ACEPTÓ: el par (resuelta_en,
     * cancelada_en) es lo que permite decir cuánto tiempo estuvo programado.
     *
     * UNA CANCELADA NO BLOQUEA UNA NUEVA POSTULACIÓN: _una_pendiente_idx es parcial sobre
     * resuelta_en IS NULL, y una cancelada la tiene puesta. Es lo correcto —cancelar una
     * participación no es vetar al DJ— y es consecuencia del índice, no de una decisión
     * aparte, así que conviene decirlo para que nadie lo "arregle".
     */
    [
      `${APPS}_motivo_check`,
      `CHECK (((motivo IS NULL) OR ((btrim(motivo, '${BLANCOS}'::text) <> ''::text) AND (resultado IS NOT NULL) AND (resultado = ANY (ARRAY['rechazada'::text, 'retirada'::text, 'cancelada'::text])))))`,
    ],
    /**
     * EL MOTIVO ES OBLIGATORIO AL CANCELAR Y OPCIONAL AL RECHAZAR, y la diferencia la
     * sostiene la base y no el formulario.
     *
     * Rechazar es no elegir a alguien; cancelar es DESHACER algo que el DJ ya tiene
     * anunciado. La única de las dos que le saca algo que ya tenía es la segunda, así que es
     * la única que tiene que explicarse.
     *
     * Al revés —motivo obligatorio también al rechazar— el dueño deja las postulaciones sin
     * resolver para no tener que escribirlo, y entonces el DJ no se entera de nada. Eso ya
     * está decidido y es el motivo de que sean dos reglas distintas sobre la misma columna.
     */
    [
      `${APPS}_cancelacion_check`,
      "CHECK ((((resultado = 'cancelada'::text) AND (cancelada_en IS NOT NULL) AND (motivo IS NOT NULL)) OR ((resultado IS DISTINCT FROM 'cancelada'::text) AND (cancelada_en IS NULL))))",
    ],
    /**
     * EL (resultado IS NOT NULL) DEL CHECK DE ARRIBA ES LO MISMO, Y ME LO COMÍ UNA LÍNEA
     * MÁS ARRIBA. Sin él, una PENDIENTE con motivo pasaba: resultado = ANY (...) con
     * resultado en NULL da NULL, el AND entero da NULL, el OR da NULL, y UN CHECK QUE DA
     * NULL PASA.
     *
     * Lo encontró una prueba que manda el INSERT de verdad, no la comparación de
     * definiciones: la definición medida coincidía con la que yo había escrito, y la que yo
     * había escrito estaba mal. Comparar la forma prueba que quedó como dice que quedó, no
     * que lo que dice sea correcto.
     */
    /**
     * IS DISTINCT FROM y no <>, y acá importa: con <> la rama derecha sería NULL cuando
     * resultado es NULL —una postulación pendiente—, el OR entero daría NULL, y un CHECK que
     * da NULL PASA. O sea que una pendiente podría tener cancelada_en puesta sin que nada
     * chille. Medido en la definición que Postgres rinde, no supuesto.
     */
    [
      `${APPS}_cancelada_por_check`,
      "CHECK (((cancelada_por IS NULL) OR (cancelada_en IS NOT NULL)))",
    ],
    /**
     * LA RESOLUCIÓN ATA LAS DOS COLUMNAS EN LOS DOS SENTIDOS, igual que el CHECK de la purga
     * de mail_outbox: permitir NULL no alcanza, hay que impedir los estados intermedios, que
     * son los que deja una escritura a medias. Una postulación resuelta sin resultado no se
     * puede mostrar, y un resultado sin fecha no se puede ordenar.
     */
    [
      `${APPS}_resolucion_check`,
      "CHECK ((((resuelta_en IS NULL) AND (resultado IS NULL)) OR ((resuelta_en IS NOT NULL) AND (resultado IS NOT NULL))))",
    ],
  ],
};

/** Las formas EXACTAS, copiadas de las que Postgres ya rinde en este esquema. */
const FKS: Record<string, Array<[string, string]>> = {
  [CALLS]: [
    [
      `${CALLS}_event_id_fkey`,
      "FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE",
    ],
    [
      `${CALLS}_collective_slug_fkey`,
      "FOREIGN KEY (collective_slug) REFERENCES collectives(slug) ON UPDATE CASCADE ON DELETE CASCADE",
    ],
    /**
     * abierta_por y cerrada_por van SET NULL y no CASCADE: si la cuenta se borra, LA
     * CONVOCATORIA SIGUIÓ PASANDO. Mismo criterio que offered_by, censored_by y reviewed_by.
     */
    [
      `${CALLS}_abierta_por_fkey`,
      "FOREIGN KEY (abierta_por) REFERENCES user_profiles(email) ON UPDATE CASCADE ON DELETE SET NULL",
    ],
    [
      `${CALLS}_cerrada_por_fkey`,
      "FOREIGN KEY (cerrada_por) REFERENCES user_profiles(email) ON UPDATE CASCADE ON DELETE SET NULL",
    ],
  ],
  [APPS]: [
    [
      `${APPS}_call_id_fkey`,
      `FOREIGN KEY (call_id) REFERENCES ${CALLS}(id) ON DELETE CASCADE`,
    ],
    /**
     * CASCADE al artista, y es a propósito: una postulación sin postulante no se puede
     * juzgar. Al revés que dj_sets, donde la fila sobrevive porque artist_name la sostiene.
     */
    [
      `${APPS}_artist_slug_fkey`,
      "FOREIGN KEY (artist_slug) REFERENCES artists(slug) ON UPDATE CASCADE ON DELETE CASCADE",
    ],
    [
      `${APPS}_resuelta_por_fkey`,
      "FOREIGN KEY (resuelta_por) REFERENCES user_profiles(email) ON UPDATE CASCADE ON DELETE SET NULL",
    ],
    /**
     * cancelada_por va SET NULL por el mismo criterio que resuelta_por y cerrada_por: si la
     * cuenta del dueno se borra, LA CANCELACION SIGUIO PASANDO, y el motivo sigue ahi.
     */
    [
      `${APPS}_cancelada_por_fkey`,
      "FOREIGN KEY (cancelada_por) REFERENCES user_profiles(email) ON UPDATE CASCADE ON DELETE SET NULL",
    ],
  ],
};

const INDICES: Record<string, Array<[string, string]>> = {
  [CALLS]: [
    /**
     * UNA SOLA ABIERTA POR EVENTO. Parcial, como residency_offers_una_abierta_idx y por lo
     * mismo: el histórico tiene que poder tener varias cerradas del mismo evento.
     */
    [
      `${CALLS}_una_abierta_idx`,
      `CREATE UNIQUE INDEX ${CALLS}_una_abierta_idx ON public.${CALLS} USING btree (event_id) WHERE (cerrada_en IS NULL)`,
    ],
    /** Para el barrido: busca las abiertas por su fecha de cierre. Parcial por lo mismo. */
    [
      `${CALLS}_por_cerrar_idx`,
      `CREATE INDEX ${CALLS}_por_cerrar_idx ON public.${CALLS} USING btree (cierra_en) WHERE (cerrada_en IS NULL)`,
    ],
    [
      `${CALLS}_colectivo_idx`,
      `CREATE INDEX ${CALLS}_colectivo_idx ON public.${CALLS} USING btree (collective_slug, creada_en DESC)`,
    ],
  ],
  [APPS]: [
    /** UNA SOLA PENDIENTE por DJ y convocatoria. Puede haber varias resueltas: si se retiró
     *  y se vuelve a postular, el histórico queda. */
    [
      `${APPS}_una_pendiente_idx`,
      `CREATE UNIQUE INDEX ${APPS}_una_pendiente_idx ON public.${APPS} USING btree (call_id, artist_slug) WHERE (resuelta_en IS NULL)`,
    ],
    /** La bandeja del dueño: las postulaciones de una convocatoria. */
    [
      `${APPS}_call_idx`,
      `CREATE INDEX ${APPS}_call_idx ON public.${APPS} USING btree (call_id, creada_en DESC)`,
    ],
    /** La bandeja del DJ: sus postulaciones, de la más nueva a la más vieja. */
    [
      `${APPS}_artista_idx`,
      `CREATE INDEX ${APPS}_artista_idx ON public.${APPS} USING btree (artist_slug, creada_en DESC)`,
    ],
  ],
};

/**
 * EL ÍNDICE AJENO SE VERIFICA POR DEFINICIÓN, NO POR NOMBRE.
 *
 * Es lo único que esta migración afirma sobre una tabla que no crea, o sea justamente lo
 * que NO controla, y la primera versión lo chequeaba con un startsWith del nombre. Eso
 * contradice la regla dura del repo —"la DEFINICIÓN de cada índice y no su nombre"— y
 * contradice el precedente de setup-censura-galeria, que verifica su FK preexistente por
 * definición y deja escrito por qué.
 *
 * Lo que habilitaba: alguien recrea el índice a mano sin UNIQUE o sin el WHERE, el
 * startsWith sigue dando true, la migración loguea que sigue en su lugar y devuelve
 * verificado:true — y el código que da la unicidad por sentada nunca recibe la violación que
 * espera convertir en 409.
 */
const INDICE_LINEUP: [string, string] = [
  "event_lineup_event_artist_idx",
  "CREATE UNIQUE INDEX event_lineup_event_artist_idx ON public.event_lineup USING btree (event_id, artist_slug) WHERE (artist_slug IS NOT NULL)",
];

type Columna = { nombre: string; tipo: string; aceptaNull: boolean; default: string | null };
type Forma = { existe: boolean; columnas: Columna[]; checks: string[]; fks: string[]; indices: string[] };
type Estado = { formas: Record<string, Forma>; conteos: Record<string, number> };

function verificarForma(e: Estado): { ok: boolean; problemas: string[] } {
  const p: string[] = [];

  for (const tabla of TABLAS) {
    const f = e.formas[tabla];
    if (!f?.existe) {
      p.push(`falta la tabla ${tabla}`);
      continue;
    }

    for (const [nombre, patronTipo, aceptaNull, def] of COLUMNAS[tabla]) {
      const c = f.columnas.find((x) => x.nombre === nombre);
      if (!c) {
        p.push(`falta ${tabla}.${nombre}`);
        continue;
      }
      if (!patronTipo.test(c.tipo)) p.push(`${tabla}.${nombre} EXISTE PERO es ${c.tipo}`);
      if (c.aceptaNull !== aceptaNull) {
        p.push(
          `${tabla}.${nombre} ${c.aceptaNull ? "acepta NULL" : "es NOT NULL"} y se esperaba lo contrario`
        );
      }
      if ((c.default ?? null) !== def) {
        p.push(
          `${tabla}.${nombre} tiene default ${c.default ?? "ninguno"} y se esperaba ${def ?? "ninguno"}`
        );
      }
    }

    const exacto = (lista: string[], nombre: string, esperado: string, que: string) => {
      const linea = lista.find((x) => x.startsWith(`${nombre}: `));
      if (!linea) {
        p.push(`falta ${que} ${nombre} en ${tabla}`);
        return;
      }
      const real = linea.slice(nombre.length + 2);
      if (real !== esperado) {
        p.push(
          `${que} ${nombre} EXISTE PERO tiene otra definición.\n      es:      ${real}\n      debería: ${esperado}`
        );
      }
    };

    for (const [n, d] of CHECKS[tabla]) exacto(f.checks, n, d, "el CHECK");
    for (const [n, d] of FKS[tabla]) exacto(f.fks, n, d, "el FK");
    for (const [n, d] of INDICES[tabla]) exacto(f.indices, n, d, "el índice");

    /**
     * SE CUENTAN LOS TRES, no solo los FK. Un swap es por NOMBRE, así que un CHECK o un
     * índice sobrante de un intento anterior —con otro nombre— se ignoraría para siempre:
     * seguiría restringiendo, y verificado daría true. La primera versión solo contaba los
     * FK, heredado de setup-censura-galeria, y la asimetría no tenía razón.
     *
     * Los índices se cuentan SIN los _pkey, que Postgres crea solos con la PRIMARY KEY y que
     * esta migración no declara.
     */
    if (f.fks.length !== FKS[tabla].length) {
      p.push(
        `${tabla} tiene ${f.fks.length} FK y se esperaban ${FKS[tabla].length} (${f.fks.join("; ")})`
      );
    }
    if (f.checks.length !== CHECKS[tabla].length) {
      p.push(
        `${tabla} tiene ${f.checks.length} CHECK y se esperaban ${CHECKS[tabla].length} (${f.checks.join("; ")})`
      );
    }
    const sinPkey = f.indices.filter((x) => !x.startsWith(`${tabla}_pkey: `));
    if (sinPkey.length !== INDICES[tabla].length) {
      p.push(
        `${tabla} tiene ${sinPkey.length} índices además del pkey y se esperaban ` +
          `${INDICES[tabla].length} (${sinPkey.join("; ")})`
      );
    }
  }

  /**
   * Y QUE event_lineup SIGA TENIENDO SU ÚNICO, porque de eso depende que aceptar no pueda
   * duplicar una fila del lineup. Esta migración no lo crea —ya existía— pero sí lo
   * VERIFICA: la garantía que el código va a dar por sentada tiene que estar comprobada en
   * algún lado, y el mejor lado es acá.
   */
  const lineup = e.formas.event_lineup;
  if (!lineup?.existe) {
    p.push("falta la tabla event_lineup, de la que depende aceptar una postulación");
  } else {
    const [n, d] = INDICE_LINEUP;
    const linea = lineup.indices.find((x) => x.startsWith(`${n}: `));
    if (!linea) {
      p.push(
        `FALTA ${n}, que es lo que impide dos filas RESUELTAS iguales en un lineup. Sin ese ` +
          "índice, aceptar dos veces la misma postulación duplicaría la fila."
      );
    } else if (linea.slice(n.length + 2) !== d) {
      p.push(
        `el índice ${n} EXISTE PERO tiene otra definición.
      es:      ${linea.slice(n.length + 2)}
      debería: ${d}`
      );
    }
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

  const formaDe = async (tabla: string): Promise<Forma> => {
    const [existe] = await sql`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${tabla}`;
    if (!existe) return { existe: false, columnas: [], checks: [], fks: [], indices: [] };
    const columnas = await sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${tabla} ORDER BY ordinal_position`;
    const cons = await sql`
      SELECT conname, contype, pg_get_constraintdef(oid) AS def
      FROM pg_constraint WHERE conrelid = ${tabla}::regclass ORDER BY conname`;
    const indices = await sql`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = ${tabla} ORDER BY indexname`;
    return {
      existe: true,
      columnas: columnas.map((c) => ({
        nombre: c.column_name as string,
        tipo: c.data_type as string,
        aceptaNull: c.is_nullable === "YES",
        default: (c.column_default as string | null) ?? null,
      })),
      checks: cons.filter((c) => c.contype === "c").map((c) => `${c.conname}: ${c.def}`),
      fks: cons.filter((c) => c.contype === "f").map((c) => `${c.conname}: ${c.def}`),
      indices: indices.map((r) => `${r.indexname}: ${r.indexdef}`),
    };
  };

  const estado = async (): Promise<Estado> => {
    const formas: Record<string, Forma> = {};
    for (const t of [...TABLAS, "event_lineup"]) formas[t] = await formaDe(t);

    /**
     * Conteos de lo que esta migración podría tocar si estuviera mal escrita. events y
     * event_lineup se cuentan aunque no se modifiquen: un FK mal puesto o un DROP de más se
     * vería acá, y una medición que no puede cambiar no prueba nada.
     */
    const [ev] = await sql`SELECT COUNT(*)::int AS n FROM events`;
    const [li] = await sql`SELECT COUNT(*)::int AS n FROM event_lineup`;
    const conteos: Record<string, number> = {
      filas_events: ev.n as number,
      filas_event_lineup: li.n as number,
    };
    for (const t of TABLAS) {
      conteos[`filas_${t}`] = 0;
      if (formas[t].existe) {
        const [r] = await sql(`SELECT COUNT(*)::int AS n FROM ${t}`);
        conteos[`filas_${t}`] = r.n as number;
      }
    }
    return { formas, conteos };
  };

  try {
    const antes = await estado();

    if (dryRun) {
      const v = verificarForma(antes);
      log.push(
        v.ok
          ? "SIMULACIÓN: las dos tablas ya están con la forma correcta. Correrla no cambiaría nada."
          : `SIMULACIÓN: falta o está mal ${v.problemas.length} cosa(s).`
      );
      for (const x of v.problemas) log.push(`  - ${x}`);
      log.push("SIN BACKFILL: las dos tablas arrancan VACÍAS. No hay convocatorias previas.");
      log.push("NO TOCA event_lineup: su único (event_id, artist_slug) ya existe y solo se VERIFICA.");
      log.push("cierra_en <= fecha del evento NO es un CHECK: cruza tablas. Vive en el write path.");
      log.push(`Conteos: ${JSON.stringify(antes.conteos)}. events y event_lineup no pueden cambiar.`);
      return NextResponse.json({
        ok: true,
        dryRun: true,
        verificado: v.ok,
        problemas: v.problemas,
        estado: antes,
        log,
      });
    }

    /* ============ LAS TABLAS, EN UNA TRANSACCIÓN ============
     * event_applications referencia a event_calls, así que el orden importa: si entraran por
     * separado y la segunda fallara, quedaría una tabla huérfana. Postgres tiene DDL
     * transaccional incluso entre tablas distintas —medido en este repo— así que o entran
     * las dos o ninguna.
     *
     * CREATE TABLE IF NOT EXISTS compara por NOMBRE y se saltea entero si ya existe algo
     * llamado así con otra forma; por eso después van los ADD COLUMN uno por uno y los
     * CHECK, FK e índices por SWAP: cada corrida RE-AFIRMA la forma.
     */
    await sql.transaction([
      sql(`
        CREATE TABLE IF NOT EXISTS ${CALLS} (
          id SERIAL PRIMARY KEY,
          event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          collective_slug TEXT NOT NULL REFERENCES collectives(slug) ON UPDATE CASCADE ON DELETE CASCADE,
          cupos INTEGER,
          cierra_en TIMESTAMPTZ,
          cerrada_en TIMESTAMPTZ,
          cerrada_por TEXT REFERENCES user_profiles(email) ON UPDATE CASCADE ON DELETE SET NULL,
          abierta_por TEXT REFERENCES user_profiles(email) ON UPDATE CASCADE ON DELETE SET NULL,
          nota TEXT,
          creada_en TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `),
      sql(`
        CREATE TABLE IF NOT EXISTS ${APPS} (
          id SERIAL PRIMARY KEY,
          call_id INTEGER NOT NULL REFERENCES ${CALLS}(id) ON DELETE CASCADE,
          artist_slug TEXT NOT NULL REFERENCES artists(slug) ON UPDATE CASCADE ON DELETE CASCADE,
          mensaje TEXT NOT NULL,
          disponibilidad TEXT NOT NULL,
          resuelta_en TIMESTAMPTZ,
          resultado TEXT,
          resuelta_por TEXT REFERENCES user_profiles(email) ON UPDATE CASCADE ON DELETE SET NULL,
          motivo TEXT,
          cancelada_en TIMESTAMPTZ,
          cancelada_por TEXT REFERENCES user_profiles(email) ON UPDATE CASCADE ON DELETE SET NULL,
          creada_en TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `),
    ]);

    /**
     * Los ADD COLUMN, en UNA transacción y sin NOT NULL salvo donde hay default. Lo que falla
     * sobre una tabla con filas es un ADD COLUMN NOT NULL *sin* default; con DEFAULT now()
     * Postgres puede llenar las existentes. Estos solo actúan si alguien dejó una tabla a
     * medias: el NOT NULL definitivo lo afirma el CREATE TABLE, y si no quedó, verificarForma
     * lo canta.
     */
    await sql.transaction([
      sql(`ALTER TABLE ${CALLS} ADD COLUMN IF NOT EXISTS cupos INTEGER`),
      sql(`ALTER TABLE ${CALLS} ADD COLUMN IF NOT EXISTS cierra_en TIMESTAMPTZ`),
      sql(`ALTER TABLE ${CALLS} ADD COLUMN IF NOT EXISTS cerrada_en TIMESTAMPTZ`),
      sql(`ALTER TABLE ${CALLS} ADD COLUMN IF NOT EXISTS cerrada_por TEXT`),
      sql(`ALTER TABLE ${CALLS} ADD COLUMN IF NOT EXISTS abierta_por TEXT`),
      sql(`ALTER TABLE ${CALLS} ADD COLUMN IF NOT EXISTS nota TEXT`),
      sql(`ALTER TABLE ${CALLS} ADD COLUMN IF NOT EXISTS creada_en TIMESTAMPTZ NOT NULL DEFAULT now()`),
      sql(`ALTER TABLE ${APPS} ADD COLUMN IF NOT EXISTS resuelta_en TIMESTAMPTZ`),
      sql(`ALTER TABLE ${APPS} ADD COLUMN IF NOT EXISTS resultado TEXT`),
      sql(`ALTER TABLE ${APPS} ADD COLUMN IF NOT EXISTS resuelta_por TEXT`),
      sql(`ALTER TABLE ${APPS} ADD COLUMN IF NOT EXISTS motivo TEXT`),
      sql(`ALTER TABLE ${APPS} ADD COLUMN IF NOT EXISTS cancelada_en TIMESTAMPTZ`),
      sql(`ALTER TABLE ${APPS} ADD COLUMN IF NOT EXISTS cancelada_por TEXT`),
      sql(`ALTER TABLE ${APPS} ADD COLUMN IF NOT EXISTS creada_en TIMESTAMPTZ NOT NULL DEFAULT now()`),
    ]);

    /* ============ CHECKS, FK E ÍNDICES, POR SWAP ============
     * DROP IF EXISTS + ADD desnudo, los dos en una transacción. Sin la transacción hay una
     * ventana de un round-trip sin guarda; y si una fila violara el ADD, tira check_violation
     * —que NO es duplicate_object, así que el envoltorio DO $$ EXCEPTION WHEN
     * duplicate_object $$ no lo atraparía— y la transacción deja la guarda anterior en su
     * lugar en vez de dejar la tabla sin ninguna.
     */
    for (const tabla of TABLAS) {
      for (const [nombre, definicion] of CHECKS[tabla]) {
        await sql.transaction([
          sql(`ALTER TABLE ${tabla} DROP CONSTRAINT IF EXISTS ${nombre}`),
          sql(`ALTER TABLE ${tabla} ADD CONSTRAINT ${nombre} ${definicion}`),
        ]);
      }
      for (const [nombre, definicion] of FKS[tabla]) {
        await sql.transaction([
          sql(`ALTER TABLE ${tabla} DROP CONSTRAINT IF EXISTS ${nombre}`),
          sql(`ALTER TABLE ${tabla} ADD CONSTRAINT ${nombre} ${definicion}`),
        ]);
      }
      for (const [nombre, definicion] of INDICES[tabla]) {
        await sql.transaction([sql(`DROP INDEX IF EXISTS ${nombre}`), sql(definicion)]);
      }
    }

    const despues = await estado();
    const v = verificarForma(despues);
    log.push(
      v.ok
        ? `VERIFICADO: ${CALLS} con sus 10 columnas y ${APPS} con sus 12, sus 10 CHECK, sus 8 FK ` +
            "y los 6 índices que declara —dos de ellos únicos parciales— además de los dos " +
            "_pkey que Postgres crea solos. Y event_lineup_event_artist_idx sigue en su lugar, " +
            "verificado por definición y no por nombre."
        : `NO VERIFICADO: ${v.problemas.length} problema(s).`
    );
    for (const x of v.problemas) log.push(`  - ${x}`);

    const cambiaron = Object.keys(antes.conteos).filter(
      (k) => despues.conteos[k] !== antes.conteos[k]
    );
    if (cambiaron.length > 0) {
      log.push(
        `ATENCIÓN: cambió ${cambiaron.join(", ")}. Esta migración no escribe ni borra una sola ` +
          "fila, así que en main lo más probable es tráfico legítimo entre las dos mediciones."
      );
    } else {
      log.push(`Sin cambios en los datos: ${JSON.stringify(despues.conteos)}.`);
    }

    return NextResponse.json({
      ok: true,
      dryRun: false,
      verificado: v.ok && cambiaron.length === 0,
      problemas: v.problemas,
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
