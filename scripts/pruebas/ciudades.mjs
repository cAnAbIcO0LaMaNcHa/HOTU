/**
 * BATERÍA DEL AUTOCOMPLETADO DE CIUDADES.
 *
 * ============================================================
 * LO QUE ESTA BATERÍA EXISTE PARA ATRAPAR
 * ============================================================
 *
 * 1. QUE EL PLAN SE DEGRADE A Seq Scan SIN QUE NADA FALLE.
 *
 *    El `clave LIKE 'prefijo%'` se convierte en un rango sobre el índice PORQUE la base está
 *    en collation C.UTF-8 — medido en pg_database. Con otra collation Postgres no puede, y la
 *    consulta sigue devolviendo exactamente lo mismo, nada más que recorriendo 171.174 filas:
 *    113 ms contra 0,285 ms, medidos. No hay error, no hay resultado distinto, no hay nada que
 *    mirar. Es la misma familia que el toISOString que andaba sólo con offset <= 0.
 *
 *    Y LA ASERCIÓN NO ES UN NOMBRE DE ÍNDICE, a propósito. La consulta busca también por
 *    nombre_es, y ese `OR` hace que Postgres prefiera cities_pais_poblacion_idx o un bitmap —
 *    cosa que está bien y está medida. Exigir cities_pais_clave_idx haría fallar una consulta
 *    correcta. Lo que importa es que el PAÍS acote el scan, así que eso es lo que se exige.
 *
 * 2. QUE UN `%` EN LA ENTRADA DESARME EL PREFIJO.
 *
 *    Sin escapar los metacaracteres de LIKE, teclear `%` manda `clave LIKE '%%'`, que matchea
 *    todo: la consulta deja de estar acotada y recorre el país entero. El `_` es más sutil y la
 *    barra invertida es el carácter de escape de LIKE en Postgres. Se prueba de punta a punta,
 *    no sólo mirando el string que devuelve patronDe.
 *
 * 3. QUE SE PIERDA LA BÚSQUEDA EN ESPAÑOL.
 *
 *    "londres" tiene que encontrar London. Medido: sin la rama de nombre_es da 0 resultados.
 *    Si alguien "optimiza" la consulta sacando ese OR, la ruta sigue andando y el español
 *    deja de funcionar en silencio.
 *
 * 4. QUE LA RUTA ACEPTE UNA BÚSQUEDA SIN PAÍS.
 *
 *    Que es el punto 1 por la puerta de adelante.
 *
 * ============================================================
 * NO ESCRIBE NADA, Y TOMA EL CANDADO IGUAL
 * ============================================================
 *
 * Sólo lee cities, que ninguna otra batería toca. Pero abre con abrirCorrida() como todas
 * porque el candado no está para proteger a ESTA de las otras: está para que el conjunto de
 * baterías tenga una sola forma de arrancar. Una que se saltea el candado "porque no escribe"
 * es la excepción que alguien copia el día que sí escribe.
 */

import { register } from "node:module";
import { pathToFileURL } from "node:url";
/** La bandera va ANTES del register: el hook la lee al RESOLVER @/auth. */
process.env.ZZ_AUTH_FALSA = "1";
register("./scripts/pruebas/hook-rutas.mjs", pathToFileURL("./"));

import { neon } from "@neondatabase/serverless";
import { abrirCorrida } from "./seed.mjs";

const {
  buscarCiudades,
  getCiudad,
  getCiudades,
  paisValido,
  patronDe,
  sqlDeBusqueda,
  MAXIMO_RESULTADOS,
  MINIMO_PARA_BUSCAR,
} = await import("../../lib/ciudades.ts");
const { nombreMostrable, textoLegadoDe } = await import("../../lib/ciudades-tipos.ts");
const { normalizarEnSql } = await import("../../lib/convocatorias.ts");
const { normalizarNombre } = await import("../../lib/lineup-import.ts");
/** La ruta de verdad, importada y llamada. No un fetch con una cookie armada a mano. */
const { GET: ciudadesGET } = await import("../../app/api/ciudades/route.ts");

const sql = neon(process.env.DATABASE_URL);

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

const pedir = async (qs, email) => {
  if (email === undefined) delete process.env.ZZ_AUTH_EMAIL;
  else process.env.ZZ_AUTH_EMAIL = email;
  const r = await ciudadesGET(new Request(`http://localhost/api/ciudades${qs}`));
  let cuerpo = null;
  try {
    cuerpo = await r.json();
  } catch {
    /* una respuesta sin cuerpo JSON es información: se refleja en cuerpo = null */
  }
  return { status: r.status, cuerpo };
};

const corrida = await abrirCorrida(sql, "bateria de ciudades");
try {
  console.log("\n== 0. la tabla está cargada, porque sin eso todo lo demás da vacío y pasa");
  const [{ n }] = await sql`SELECT COUNT(*)::int n FROM cities`;
  chk(`cities tiene filas (${n})`, n > 100000, `sólo ${n}`);
  const [{ col }] = await sql`SELECT datcollate AS col FROM pg_database WHERE datname = current_database()`;
  console.log(`   (collation de la base: ${col})`);

  console.log("\n== 1. EL PLAN: el país acota el scan y cities nunca se recorre entera");
  for (const [pais, q] of [
    ["COL", "bogo"],
    ["USA", "new"],
    ["GBR", "londres"],
    ["MEX", "san"],
  ]) {
    const patron = patronDe(q);
    const plan = (await sql(`EXPLAIN (ANALYZE) ${sqlDeBusqueda(MAXIMO_RESULTADOS)}`, [pais, patron]))
      .map((r) => r["QUERY PLAN"])
      .join("\n");
    const seq = /Seq Scan on cities/.test(plan);
    const acotado = /country_code = /.test(plan);
    const ms = Number(plan.match(/Execution Time: ([\d.]+)/)?.[1] ?? "9999");
    chk(`${pais} "${q}": sin Seq Scan sobre cities`, !seq, plan.split("\n").find((l) => /Seq Scan/.test(l))?.trim());
    chk(`${pais} "${q}": el país está en la condición`, acotado, "el plan no menciona country_code");
    /**
     * CUÁNTAS FILAS DESCARTÓ, NO CUÁNTOS MILISEGUNDOS TARDÓ.
     *
     * Acá había un umbral de 100 ms y falló: dio 134 contra 3,7 de la corrida anterior. La
     * causa estaba clara y era transitoria —la tabla se había reescrito dos veces, el
     * SET EXPRESSION y la recarga, así que la caché de Neon estaba fría— o sea un MAL por algo
     * que no era una regresión.
     *
     * Un tiempo de pared contra una base remota por HTTP no es un invariante: depende de la
     * caché, de la red y de si alguien más está consultando. Y una batería que falla por
     * motivos que no son defectos se deja de leer, que es el costo real.
     *
     * Lo que sí es invariante es CUÁNTO TUVO QUE DESCARTAR, y el límite es EL TAMAÑO DEL PAÍS,
     * no un número que yo elija.
     *
     * Primero puse 10.000 y falló con USA: descartó 17.096. No era un escape — USA tiene
     * 17.343 filas, o sea que descartó el país entero. Eso es lo que hace la rama de nombre_es:
     * Postgres deja cities_pais_clave_idx, recorre el país por cities_pais_poblacion_idx y
     * filtra. Está medido y es aceptable: 32 ms en el peor país.
     *
     * Un umbral absoluto habría dado MAL por una consulta correcta, que es el mismo error que
     * acababa de cometer con los milisegundos. El límite tiene que salir del dato: el scan
     * puede recorrer su país y NO puede recorrer la tabla. La diferencia entre las dos cosas es
     * de un orden de magnitud —17.343 contra 170.739— así que la aserción discrimina de sobra.
     */
    const [{ delPais }] = await sql(
      `SELECT COUNT(*)::int AS "delPais" FROM cities WHERE country_code = $1`,
      [pais]
    );
    const descartadas = Math.max(
      0,
      ...[...plan.matchAll(/Rows Removed by Filter: (\d+)/g)].map((m) => Number(m[1]))
    );
    chk(
      `${pais} "${q}": descartó ${descartadas}, acotado por el país (${delPais}), no por la ` +
        `tabla (${ms.toFixed(1)} ms)`,
      descartadas <= delPais,
      `descartó ${descartadas} y el país tiene ${delPais}: el scan se salió del país`
    );
  }

  console.log("\n== 1b. y la prueba falla con la consulta SIN país, que es el caso malo");
  {
    const plan = (
      await sql(
        `EXPLAIN (ANALYZE) SELECT geonames_id FROM cities WHERE clave LIKE $1
         ORDER BY poblacion DESC LIMIT 8`,
        ["new%"]
      )
    )
      .map((r) => r["QUERY PLAN"])
      .join("\n");
    /**
     * Esto es lo que vuelve a la aserción de arriba una prueba y no una decoración: si el
     * detector de Seq Scan estuviera roto, acá daría MAL y se vería en la misma corrida.
     */
    chk("sin país la MISMA forma de consulta SÍ es Seq Scan", /Seq Scan on cities/.test(plan), "no detecta el caso malo");
  }

  console.log("\n== 2. los metacaracteres de LIKE se escapan, de punta a punta");
  chk("patronDe escapa %", patronDe("bo%go") === "bo\\%go%", JSON.stringify(patronDe("bo%go")));
  chk("patronDe escapa _", patronDe("bo_go") === "bo\\_go%", JSON.stringify(patronDe("bo_go")));
  chk(
    "patronDe escapa la barra invertida",
    patronDe("bo\\go") === "bo\\\\go%",
    JSON.stringify(patronDe("bo\\go"))
  );
  {
    const todo = await buscarCiudades("COL", "%%");
    chk("buscar '%%' NO devuelve el país entero", todo.length === 0, `devolvió ${todo.length}`);
    const guion = await buscarCiudades("COL", "__");
    chk("buscar '__' NO devuelve el país entero", guion.length === 0, `devolvió ${guion.length}`);
    const bogota = await buscarCiudades("COL", "bo%");
    chk("y 'bo%' tampoco empareja de más", bogota.length === 0, `devolvió ${bogota.map((c) => c.nombre).join(", ")}`);
  }

  console.log("\n== 3. la búsqueda en español, que es la mitad del valor del selector");
  {
    const londres = await buscarCiudades("GBR", "londres");
    chk("'londres' en GBR encuentra London", londres.some((c) => c.nombre === "London"), londres.map((c) => c.nombre).join(", ") || "nada");
    const soloClave = await sql(
      `SELECT nombre FROM cities WHERE country_code='GBR' AND clave LIKE $1 LIMIT 5`,
      ["londres%"]
    );
    /** La contracara: sin la rama de nombre_es no habría nada. Si esto deja de dar 0, la
     *  búsqueda en español habría dejado de ser necesaria y habría que mirar por qué. */
    chk("y por clave sola NO lo encontraría (0 filas)", soloClave.length === 0, `dio ${soloClave.length}`);
    const nuevaYork = await buscarCiudades("USA", "nueva york");
    chk("'nueva york' encuentra New York City", nuevaYork.some((c) => c.nombre === "New York City"), nuevaYork.map((c) => c.nombre).join(", ") || "nada");
  }

  console.log("\n== 4. lo que ya se usa en main, que es lo que no puede dejar de andar");
  for (const [q, esperado] of [
    ["bogo", "Bogotá"],
    ["BOGOTA", "Bogotá"],
    ["chía", "Chía"],
    ["CHIA", "Chía"],
    ["la calera", "La Calera"],
    ["medellin", "Medellín"],
    ["Medellín", "Medellín"],
    ["cali", "Cali"],
  ]) {
    const r = await buscarCiudades("COL", q);
    chk(`"${q}" -> ${esperado}`, r.some((c) => c.nombre === esperado), r.map((c) => c.nombre).join(", ") || "nada");
  }

  console.log("\n== 5. los homónimos salen todos, ordenados por población");
  {
    const bv = await buscarCiudades("COL", "buenavista");
    chk(`"buenavista" trae varias (${bv.length})`, bv.length >= 2, `trajo ${bv.length}`);
    const ordenado = bv.every((c, i) => i === 0 || bv[i - 1].poblacion >= c.poblacion);
    chk("vienen de mayor a menor población", ordenado, bv.map((c) => c.poblacion).join(" > "));
    chk("y ninguna se elige sola: todas se ofrecen", bv.length > 1, "sólo una candidata");
  }

  console.log("\n== 6. los bordes de la entrada");
  chk("país desconocido -> []", (await buscarCiudades("ZZZ", "bogo")).length === 0);
  chk("país vacío -> []", (await buscarCiudades("", "bogo")).length === 0);
  chk(`una sola letra -> [] (mínimo ${MINIMO_PARA_BUSCAR})`, (await buscarCiudades("COL", "b")).length === 0);
  chk("espacios solos -> []", (await buscarCiudades("COL", "   ")).length === 0);
  chk("patronDe de una letra es null", patronDe("b") === null);
  chk("paisValido('COL')", paisValido("COL"));
  chk("paisValido('XKX') — Kosovo entra", paisValido("XKX"));
  chk("!paisValido('CO') — alpha-2 NO", !paisValido("CO"));
  chk("!paisValido('ZZZ')", !paisValido("ZZZ"));
  {
    const tope = await buscarCiudades("USA", "sa", 50);
    chk(`el límite se recorta a ${MAXIMO_RESULTADOS} aunque se pida 50`, tope.length <= MAXIMO_RESULTADOS, `devolvió ${tope.length}`);
  }

  console.log("\n== 7. LAS CLAVES SON ASCII, Y LAS TRES QUE NO LO SON");
  /**
   * ESTA SECCIÓN DECÍA LO CONTRARIO, Y SE REESCRIBIÓ PORQUE SU PROPIO CHEQUEO LO PIDIÓ.
   *
   * Antes afirmaba un límite: 16.310 de 171.174 claves (9,53%) con diacríticos que
   * normalizarEnSql no sabía sacar, y "thane" dando CERO resultados en India. Y tenía un chk
   * que exigía que esa falla SIGUIERA ahí, con el mensaje "si ahora da resultados, el
   * asciiname entró y hay que reescribir esta sección". Entró, dio MAL, y acá está reescrita.
   *
   * Lo que cambió: /api/setup-cities-asciiname hizo que clave se derive del asciiname de
   * GeoNames —COALESCE(NULLIF(btrim(ascii_nombre, blancos), ''), nombre)— y el cargador llenó
   * la columna. MEDIDO en dev después de recargar: de 16.310 a 3.
   *
   * LAS TRES QUE QUEDAN SON LA LIGADURA œ: Hœnheim, Hœrdt y Gœrsdorf, todas francesas, y
   * GeoNames tampoco las transcribe —su asciiname es idéntico al nombre—. Están fuera del
   * alcance de la maquinaria por una razón concreta: translate() mapea UN carácter a UNO, y
   * œ -> oe son dos. No es un descuido que se pueda arreglar agregando un carácter a la lista.
   *
   * Y OJO CON CÓMO SE CUENTA, que es donde me equivoqué. La primera medición usó la clase
   * [^a-z0-9 '.()/-] y dio 248 — pero 245 de esas eran COMAS, BACKTICKS y CORCHETES, que son
   * ASCII perfectamente normal y aparecen en nombres como "Mianzhu, Deyang, Sichuan" o el
   * `Afrin con el que GeoNames escribe el ayn. Contar con un conjunto de caracteres
   * "permitidos" hecho a mano convierte cualquier signo que uno no pensó en un falso positivo.
   * La clase correcta es el rango imprimible ASCII, [^ -~], y da 3.
   */
  {
    const [esc] = await sql`SELECT
      COUNT(*) FILTER (WHERE clave ~ '[^ -~]')::int AS mundo,
      COUNT(*)::int AS total FROM cities`;
    const [colombia] = await sql`SELECT
      COUNT(*) FILTER (WHERE clave ~ '[^ -~]')::int AS malas,
      COUNT(*)::int AS total FROM cities WHERE country_code = 'COL'`;
    console.log(
      `   (claves fuera del ASCII imprimible: ${esc.mundo} de ${esc.total}, ` +
        `${(100 * esc.mundo / esc.total).toFixed(4)}%)`
    );

    /**
     * LA COLUMNA TIENE QUE ESTAR LLENA, y esto va primero porque sin eso todo lo de abajo
     * pasaría por el camino viejo sin decirlo: con ascii_nombre en NULL el COALESCE cae al
     * nombre local, las claves vuelven a tener diacríticos y los chequeos de más abajo
     * fallarían sin explicar que lo que falta es la recarga.
     */
    const [lleno] = await sql`SELECT COUNT(ascii_nombre)::int AS n, COUNT(*)::int AS total FROM cities`;
    chk(
      `ascii_nombre está llena en las ${lleno.total} filas`,
      lleno.n === lleno.total,
      `sólo ${lleno.n} de ${lleno.total} — falta correr scripts/cargar-ciudades.mjs`
    );

    /** Colombia limpia: el único país donde HOTU opera. */
    chk(
      `Colombia: 0 de ${colombia.total} claves fuera del ASCII imprimible`,
      colombia.malas === 0,
      `${colombia.malas} claves sucias`
    );

    /**
     * EL NÚMERO EXACTO, Y HACIA LOS DOS LADOS.
     *
     * No es "<= 3": es exactamente 3. Si bajara, algo mejoró y esta sección miente sobre la
     * ligadura; si subiera, la recarga trajo datos peores o la expresión de clave cambió. Las
     * dos cosas merecen un MAL que mande a mirar, y un "<=" dejaría pasar la primera en
     * silencio — que es cómo un número escrito deja de corresponder a la realidad.
     */
    chk(
      `quedan exactamente 3 claves fuera del ASCII imprimible (dio ${esc.mundo})`,
      esc.mundo === 3,
      `son ${esc.mundo} y la sección dice 3`
    );

    /** Y que sean LAS TRES de la ligadura œ, no otras tres. */
    const residuo = await sql`SELECT nombre FROM cities WHERE clave ~ '[^ -~]' ORDER BY nombre`;
    chk(
      "y son las tres francesas de la ligadura œ",
      residuo.length === 3 && residuo.every((r) => /œ/.test(r.nombre)),
      residuo.map((r) => r.nombre).join(", ")
    );

    /** Ninguna clave vacía: era el riesgo que marcó el migration-reviewer sobre el btrim. */
    const [vacias] = await sql`SELECT COUNT(*)::int AS n FROM cities WHERE clave = ''`;
    chk(
      "ninguna clave quedó vacía",
      vacias.n === 0,
      `${vacias.n} ciudades con clave '' — no se pueden buscar`
    );

    /**
     * Y LOS DOS NORMALIZADORES SIGUEN DE ACUERDO EN LATIN-1, que es el rango que el repo usa
     * para los nombres de DJ y de colectivo. Esa es la coincidencia que la otra batería
     * garantiza y que esta no puede romper.
     */
    const muestra = await sql`
      SELECT nombre FROM cities
      WHERE nombre ~ '[À-ÿ]' AND nombre !~ '[^ -ÿ]' AND country_code IN ('COL','ESP','MEX','ARG','BRA')
      ORDER BY poblacion DESC LIMIT 40`;
    const discrepan = [];
    for (const { nombre } of muestra) {
      const [{ enSql }] = await sql(`SELECT ${normalizarEnSql("$1")} AS "enSql"`, [nombre]);
      if (enSql !== normalizarNombre(nombre)) discrepan.push(nombre);
    }
    chk(
      `los ${muestra.length} nombres Latin-1 normalizan igual en JS y en SQL`,
      discrepan.length === 0 && muestra.length >= 20,
      discrepan.length > 0 ? discrepan.join(", ") : `sólo ${muestra.length} en la muestra`
    );

    /**
     * Y LO QUE ANTES FALLABA, AHORA ANDA. Estas cuatro eran los ejemplos del defecto: se
     * tipeaban sin diacríticos y daban cero. Quedan como chequeos porque son la prueba de que
     * la recarga sirvió, y porque si alguien recreara cities desde setup-cities —que la deja
     * con la expresión vieja— volverían a dar cero y se vería acá.
     */
    for (const [pais, escrito, esperado] of [
      ["IND", "thane", "Thāne"],
      ["IND", "rajkot", "Rājkot"],
      ["VNM", "hue", "Huế"],
      ["TUR", "istanbul", "Istanbul"],
    ]) {
      const r = await buscarCiudades(pais, escrito);
      chk(
        `${pais} "${escrito}" (sin diacríticos) encuentra ${esperado}`,
        r.some((c) => c.nombre === esperado),
        r.map((c) => c.nombre).join(", ") || "nada"
      );
    }

    /**
     * LA LIGADURA SIGUE SIN ENCONTRARSE, y se afirma en vez de omitirse: "hoenheim" no da
     * nada y no hay forma de que dé con translate(), que es 1 a 1. Dejarlo sin medir haría
     * que la sección de arriba pareciera una limitación razonada cuando en realidad nadie la
     * comprobó.
     */
    const hoe = await buscarCiudades("FRA", "hoenheim");
    chk(
      "y 'hoenheim' sigue sin encontrar Hœnheim, que es el residuo escrito",
      hoe.length === 0,
      `ahora da ${hoe.map((c) => c.nombre).join(", ")} — la ligadura se arregló y hay que decirlo`
    );
  }

  console.log("\n== 7b. EN QUÉ PUNTO DEL TRAMO ESTAMOS: tres estados, y había dos");
  /**
   * ESTO EXISTE PORQUE EL LOG MINTIÓ EN MAIN, Y SE VIO.
   *
   * El dryRun de /api/setup-cities-asciiname, corrido entre el paso 2 (reexpresar) y el paso 3
   * (recargar), imprimió: "La recarga ya pasó: 0 de 171174 fila(s) tienen el nombre ASCII".
   * Falso, y además contradiciéndose en la misma oración.
   *
   * La causa: la línea elegía con `yaEstaba`, que significa "la expresión de clave ya es la
   * nueva" y NO "la recarga pasó". Entre esos dos pasos las dos cosas difieren, y el estado
   * del medio es JUSTO el que alguien mira para decidir si ya puede recargar.
   *
   * SE PRUEBA LA FUNCIÓN PURA Y NO LA RUTA, a propósito: reproducir el estado del medio contra
   * la base exige vaciar ascii_nombre en las 171.174 filas y recargarlas, dos minutos y
   * tocando los datos. Una prueba así no se corre. Con la decisión afuera del handler, las
   * tres ramas se ejercitan en milisegundos.
   */
  {
    const { estadoDeRecarga } = await import("../../lib/ciudades-tramo.ts");

    const a = estadoDeRecarga({ expresionAplicada: false, conAsciiNombre: 0, filas: 171174 });
    chk("sin reexpresar -> 'sin-reexpresar'", a.estado === "sin-reexpresar", a.estado);
    chk("y dice que no cambia ninguna clave", /NO CAMBIA NINGUNA CLAVE/.test(a.mensaje), a.mensaje);

    /** EL CASO QUE FALLÓ EN MAIN. */
    const b = estadoDeRecarga({ expresionAplicada: true, conAsciiNombre: 0, filas: 171174 });
    chk("reexpresada y columna VACÍA -> 'falta-recargar'", b.estado === "falta-recargar", b.estado);
    chk("y NO dice que la recarga ya pasó", !/ya pasó/.test(b.mensaje), b.mensaje);
    chk("y manda a correr el cargador", /cargar-ciudades/.test(b.mensaje), b.mensaje);

    const c = estadoDeRecarga({ expresionAplicada: true, conAsciiNombre: 171174, filas: 171174 });
    chk("reexpresada y columna llena -> 'recargada'", c.estado === "recargada", c.estado);
    chk("y recién ahí dice que la recarga pasó", /ya pasó/.test(c.mensaje), c.mensaje);
    chk("y no habla de que falte nada", !/[Ff]altan/.test(c.mensaje), c.mensaje);

    /**
     * Y EL CUARTO ESTADO QUE NO ES UN ESTADO: una recarga a medias. No tiene nombre propio
     * —es 'recargada'— pero el mensaje tiene que decir cuántas faltan, porque una carga que se
     * cortó a mitad se ve igual que una completa si sólo se mira el estado.
     */
    const d = estadoDeRecarga({ expresionAplicada: true, conAsciiNombre: 100000, filas: 171174 });
    chk("recarga a medias sigue siendo 'recargada'", d.estado === "recargada", d.estado);
    chk("pero avisa que faltan 71174", /71174/.test(d.mensaje) && /a medias/.test(d.mensaje), d.mensaje);

    /** El borde: una sola fila cargada ya no es "falta recargar". */
    const e = estadoDeRecarga({ expresionAplicada: true, conAsciiNombre: 1, filas: 171174 });
    chk("con UNA fila cargada ya no dice 'falta recargar'", e.estado === "recargada", e.estado);
  }

  console.log("\n== 8. getCiudad y getCiudades");
  {
    const bog = await getCiudad(3688689);
    chk("getCiudad(3688689) es Bogotá", bog?.nombre === "Bogotá", JSON.stringify(bog));
    chk("getCiudad de un id que no existe es null", (await getCiudad(1)) === null);
    chk("getCiudad de algo que no es entero es null", (await getCiudad(1.5)) === null);
    const varias = await getCiudades([3688689, 3674962, 3687925, 3688689, 1]);
    chk("getCiudades devuelve las 3 que existen, sin repetir", varias.size === 3, `devolvió ${varias.size}`);
    chk("y las indexa por id", varias.get(3674962)?.nombre === "Medellín", JSON.stringify([...varias.keys()]));
    chk("getCiudades([]) es un Map vacío", (await getCiudades([])).size === 0);
  }

  console.log("\n== 9. cómo se muestra y qué texto se guarda");
  {
    const londres = (await buscarCiudades("GBR", "londres")).find((c) => c.nombre === "London");
    chk("Londres se muestra con los dos nombres", nombreMostrable(londres) === "Londres (London)", nombreMostrable(londres));
    chk("y el texto legado que se guarda es el de GeoNames", textoLegadoDe(londres) === "London", textoLegadoDe(londres));
    const bog = await getCiudad(3688689);
    chk("Bogotá, sin nombre en español, se muestra una sola vez", nombreMostrable(bog) === "Bogotá", nombreMostrable(bog));
    const cali = await getCiudad(3687925);
    chk("Cali, con los dos nombres iguales, no se repite", nombreMostrable(cali) === "Cali", nombreMostrable(cali));
    chk("y el texto legado de Bogotá es lo que main ya tiene", textoLegadoDe(bog) === "Bogotá", textoLegadoDe(bog));
  }

  console.log("\n== 10. LA RUTA: sesión, país obligatorio, y el 200 vacío de la primera tecla");
  {
    const sin = await pedir("?pais=COL&q=bogo", undefined);
    chk("sin sesión -> 401", sin.status === 401, String(sin.status));

    const EMAIL = "zz-ciudades@test.hotu.local";
    const sinPais = await pedir("?q=bogo", EMAIL);
    chk("con sesión y SIN pais -> 400", sinPais.status === 400, String(sinPais.status));
    chk("y el 400 dice que el país es obligatorio", /país/i.test(sinPais.cuerpo?.error ?? ""), sinPais.cuerpo?.error);

    const paisRaro = await pedir("?pais=ZZZ&q=bogo", EMAIL);
    chk("país inventado -> 400", paisRaro.status === 400, String(paisRaro.status));
    const alpha2 = await pedir("?pais=CO&q=bogo", EMAIL);
    chk("alpha-2 'CO' -> 400 (las tablas guardan alpha-3)", alpha2.status === 400, String(alpha2.status));

    const corta = await pedir("?pais=COL&q=b", EMAIL);
    chk("una sola letra -> 200 con lista vacía, NO 400", corta.status === 200 && corta.cuerpo.ciudades.length === 0, `${corta.status} ${JSON.stringify(corta.cuerpo)}`);
    chk("y dice cuál es el mínimo", corta.cuerpo.minimo === MINIMO_PARA_BUSCAR, JSON.stringify(corta.cuerpo));

    const bien = await pedir("?pais=COL&q=bogo", EMAIL);
    chk("una búsqueda buena -> 200 con Bogotá", bien.status === 200 && bien.cuerpo.ciudades.some((c) => c.nombre === "Bogotá"), JSON.stringify(bien.cuerpo).slice(0, 200));

    const minusculas = await pedir("?pais=col&q=bogo", EMAIL);
    chk("el país en minúsculas también sirve", minusculas.status === 200 && minusculas.cuerpo.ciudades.length > 0, String(minusculas.status));

    const pct = await pedir("?pais=COL&q=" + encodeURIComponent("%%"), EMAIL);
    chk("y por la ruta, '%%' tampoco trae el país entero", pct.status === 200 && pct.cuerpo.ciudades.length === 0, JSON.stringify(pct.cuerpo).slice(0, 120));
  }
} finally {
  delete process.env.ZZ_AUTH_EMAIL;
  const resumen = await corrida.cerrar();
  console.log(`\nbarrido: ${JSON.stringify(resumen?.borrado ?? {})}`);
}

console.log(`\n=== ${ok} OK, ${mal} MAL ===`);
process.exit(mal === 0 ? 0 : 1);
