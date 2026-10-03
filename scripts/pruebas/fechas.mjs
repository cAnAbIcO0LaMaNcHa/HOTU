/**
 * toISODate Y LOS TRES OFFSETS.
 *
 *   node --env-file=.env.local scripts/pruebas/fechas.mjs
 *
 * Una columna DATE de Postgres nunca puede corrérsele un día, y la versión vieja de
 * toISODate se la corría en cualquier server adelantado de UTC porque pasaba por
 * toISOString().
 *
 * ============================================================
 * ESTA PRUEBA FALLA CON EL CÓDIGO VIEJO, Y ESO ES EL PUNTO
 * ============================================================
 *
 * Incluye la implementación VIEJA al lado de la nueva y las corre contra los mismos tres
 * casos. No es decoración: una prueba que pasa con las dos versiones no está probando el
 * arreglo, está probando que la función existe. Acá se ve que la vieja falla en +02:00 y
 * la nueva no, en la misma corrida.
 *
 * ============================================================
 * NO USA LA ZONA DEL PROCESO, PORQUE NO SE PUEDE
 * ============================================================
 *
 * Intenté primero poner TZ=Europe/Madrid delante de node para simular un server
 * adelantado, y en Windows NO toma efecto: Intl seguía reportando America/Bogota. Una
 * prueba que cree estar en otra zona y no lo está da OK sin medir nada.
 *
 * Así que el offset se mete en el DATO y no en el entorno: se construye el Date desde un
 * instante con offset explícito, que es exactamente lo que el driver hace cuando el server
 * corre en esa zona. El mecanismo es el mismo y no depende de qué máquina lo corra.
 */

import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";

let ok = 0;
let mal = 0;
const chk = (n, c, d = "") => {
  if (c) {
    ok++;
    console.log("   OK   " + n);
  } else {
    mal++;
    console.log("   MAL  " + n + (d ? " -> " + d : ""));
  }
};

/** La implementación NUEVA, importada de verdad quitándole el export. */
const fuente = readFileSync("lib/date-utils.ts", "utf8");
const cuerpo = fuente.slice(
  fuente.indexOf("export function toISODate"),
  fuente.indexOf("/** Format a date as DD.MM.YY")
);
const toISODate = new Function(
  `${cuerpo.replace("export function", "function").replace(/: unknown|: string/g, "")}; return toISODate;`
)();

/** La implementación VIEJA, tal cual era, para poder mostrar que fallaba. */
const toISODateVieja = (value) =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

/**
 * ============================================================
 * CÓMO SE SIMULA "EL MISMO CÓDIGO EN OTRA ZONA", Y DOS INTENTOS QUE ESTABAN MAL
 * ============================================================
 *
 * INTENTO 1, descartado: TZ=Europe/Madrid delante de node. En Windows NO toma efecto —Intl
 * seguía reportando America/Bogota— así que la prueba se habría creído en otra zona sin
 * estarlo, dando OK sin medir nada.
 *
 * INTENTO 2, descartado y más interesante porque PARECÍA andar: construir el Date desde un
 * instante con offset explícito, `new Date("2026-02-14T00:00:00+02:00")`. Eso crea un
 * instante, pero la mitad que LEE —getFullYear y compañía— sigue usando la zona del
 * proceso, o sea Bogotá. Las dos mitades quedaban en zonas distintas, y entonces hasta la
 * implementación NUEVA "fallaba" en +00:00. El bug era del helper.
 *
 * Y ahí está la lección que importa para entender el arreglo: el driver escribe las partes
 * en la zona del server, y la función las lee en la MISMA zona. Las dos mitades se
 * cancelan, y por eso leer partes locales es correcto en cualquier zona. El viejo
 * toISOString rompía justamente esa simetría: escribía en local y leía en UTC.
 *
 * LO QUE SÍ FUNCIONA es modelar el objeto que el driver devolvería en una zona dada:
 *
 *   - sus partes LOCALES son el día de calendario (es lo que el driver escribió),
 *   - su INSTANTE es medianoche de ese día en esa zona (de donde sale su toISOString).
 *
 * Es un modelo y se dice que lo es, pero es un modelo fiel de las dos propiedades que las
 * dos implementaciones usan, y no depende de qué máquina lo corra. La sección 6 cierra el
 * círculo contra la base de verdad, en la zona real.
 */
class DateDeOtraZona extends Date {
  constructor(dia, offsetMin) {
    const [y, m, d] = dia.split("-").map(Number);
    /** El instante: medianoche de ese día en esa zona. */
    super(Date.UTC(y, m - 1, d) - offsetMin * 60000);
    this._y = y;
    this._m = m;
    this._d = d;
  }
  /** Las partes locales, como las vería el proceso corriendo EN esa zona. */
  getFullYear() {
    return this._y;
  }
  getMonth() {
    return this._m - 1;
  }
  getDate() {
    return this._d;
  }
}

/** Minutos al ESTE de UTC. -05:00 son -300. */
const comoLoArmaElDriver = (dia, offsetMin) => new DateDeOtraZona(dia, offsetMin);

const CASOS = [
  [-300, "-05:00", "Bogotá, donde corre el desarrollo"],
  [0, "+00:00", "UTC, donde corre Vercel"],
  [120, "+02:00", "un server adelantado de UTC"],
];
const DIA = "2026-02-14";

console.log("=== 1. LA NUEVA DEVUELVE EL DÍA DE CALENDARIO EN LOS TRES OFFSETS ===");
for (const [min, etiqueta, que] of CASOS) {
  const d = comoLoArmaElDriver(DIA, min);
  chk(`${etiqueta} (${que})`, toISODate(d) === DIA, `dio ${toISODate(d)}`);
}

console.log("\n=== 2. LA VIEJA FALLABA, Y ACÁ SE VE CUÁL Y CÓMO ===");
{
  let fallos = 0;
  for (const [min, etiqueta, que] of CASOS) {
    const d = comoLoArmaElDriver(DIA, min);
    const r = toISODateVieja(d);
    if (r !== DIA) {
      fallos++;
      console.log(`   (la vieja en ${etiqueta} daba ${r} — ${que})`);
    }
  }
  /**
   * Se exige que la vieja falle AL MENOS UNA VEZ. Si algún día dejara de fallar,
   * significaría que la copia vieja de acá ya no es la que había, y entonces la sección 1
   * estaría comparando la nueva contra sí misma.
   */
  chk("la implementación vieja falla en al menos un offset", fallos >= 1, "no falló en ninguno: la copia vieja ya no es la que era");
  chk("y falla SOLO en el adelantado de UTC", fallos === 1, `falló en ${fallos}`);
}

console.log("\n=== 3. LOS BORDES: FIN DE MES, FIN DE AÑO Y UN AÑO BISIESTO ===");
{
  /** Un día antes del cambio de mes es donde un corrimiento de un día se nota más. */
  for (const dia of ["2026-01-01", "2026-12-31", "2026-03-01", "2024-02-29", "2026-10-31"]) {
    let todos = true;
    for (const [min] of CASOS) {
      if (toISODate(comoLoArmaElDriver(dia, min)) !== dia) todos = false;
    }
    chk(`${dia} en los tres offsets`, todos, "alguno se corrió");
  }
}

console.log("\n=== 4. EL PADDING, QUE ES DONDE UN ARREGLO A MANO SE EQUIVOCA ===");
{
  /** getMonth() devuelve 0-11 y getDate() no viene con cero adelante: sin padStart, el 5
   *  de marzo saldría "2026-3-5" y cualquier comparación de strings se rompería. */
  const d = comoLoArmaElDriver("2026-03-05", "-05:00");
  chk("el 5 de marzo sale 2026-03-05 y no 2026-3-5", toISODate(d) === "2026-03-05", toISODate(d));
  const e = comoLoArmaElDriver("2026-11-09", "-05:00");
  chk("y el 9 de noviembre, 2026-11-09", toISODate(e) === "2026-11-09", toISODate(e));
}

console.log("\n=== 5. LO QUE NO ES UN Date SIGUE ANDANDO IGUAL ===");
{
  /** La rama de string no cambió, y hay llamadores que le pasan strings. */
  chk("un string ISO se recorta a 10", toISODate("2026-02-14T00:00:00.000Z") === "2026-02-14", toISODate("2026-02-14T00:00:00.000Z"));
  chk("un string ya corto queda igual", toISODate("2026-02-14") === "2026-02-14", toISODate("2026-02-14"));
}

console.log("\n=== 6. CONTRA LA BASE DE VERDAD, QUE ES LO QUE IMPORTA ===");
{
  /**
   * Las nueve columnas que pasan por toISODate son DATE y ninguna es timestamptz —medido
   * contra information_schema— así que acá se comprueba con la de verdad: se le pide a
   * Postgres la misma fecha como texto y como date, y las dos tienen que coincidir después
   * de pasar por la función.
   */
  const url = readFileSync(".env.local", "utf8").match(/^DATABASE_URL=(.+)$/m)[1].trim().replace(/^["']|["']$/g, "");
  const sql = neon(url);

  for (const dia of ["2026-02-14", "2026-01-01", "2026-12-31", "2024-02-29"]) {
    const [r] = await sql`SELECT ${dia}::date AS d, to_char(${dia}::date, 'YYYY-MM-DD') AS texto`;
    chk(
      `${dia}: lo que da la función coincide con el to_char de Postgres`,
      toISODate(r.d) === r.texto,
      `funcion=${toISODate(r.d)} postgres=${r.texto}`
    );
  }

  /** Y que el driver siga armando medianoche LOCAL, que es el supuesto del arreglo. Si un
   *  día cambiara, este chequeo avisa antes de que las fechas se corran. */
  const [x] = await sql`SELECT '2026-02-14'::date AS d`;
  chk(
    "el driver sigue armando el Date en medianoche LOCAL (el supuesto del arreglo)",
    x.d instanceof Date && x.d.getHours() === 0,
    `getHours()=${x.d?.getHours?.()}`
  );

  /** Las nueve columnas siguen siendo date y ninguna timestamptz. */
  const tipos = await sql`
    SELECT DISTINCT data_type FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = ANY(ARRAY['joined_at','released_at','recorded_at','published_at',
                                  'gig_date','event_date','news_date','from_date','to_date'])
  `;
  const soloDate = tipos.length === 1 && tipos[0].data_type === "date";
  chk(
    "las nueve columnas que pasan por acá siguen siendo DATE",
    soloDate,
    `tipos: ${tipos.map((t) => t.data_type).join(", ")} — si aparece timestamptz, las partes locales ya no son la respuesta`
  );
}

console.log(`\n=== ${ok} OK, ${mal} MAL ===`);
process.exit(mal === 0 ? 0 : 1);
