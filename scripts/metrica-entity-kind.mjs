/**
 * LA MÉTRICA DE CONDICIONALES DE entity_kind, DEFINIDA POR ESCRITO Y CORRIBLE.
 *
 *   node scripts/metrica-entity-kind.mjs
 *   node scripts/metrica-entity-kind.mjs --detalle     (imprime los 60, uno por uno)
 *
 * ============================================================
 * POR QUÉ EXISTE, Y POR QUÉ NO APAGA NINGUNA ALARMA
 * ============================================================
 *
 * TANDA-3 §5.2 dice que si compartir tabla entre venue y colectivo obliga a llenar el
 * código de condicionales, hay que separar. AGENTS.md fija el número contra el que
 * comparar —32 líneas en 7 archivos al cerrar la pieza C— y el límite: si un archivo
 * pasa de ~10 o el total pasa de ~50, volver a mirar.
 *
 * Ese límite YA SE PASÓ: hoy da 60 en 15 archivos, con uno en 14. Y la decisión tomada
 * fue NO separar.
 *
 * ENTONCES ESTE ARCHIVO TIENE UN PROBLEMA DE CREDIBILIDAD QUE HAY QUE RESOLVER ANTES DE
 * MIRAR UN SOLO NÚMERO: cambiar cómo se mide, justo después de que la medición vieja
 * disparó, es la forma más común de apagar una alarma sin decir que se la apaga. Así
 * que:
 *
 *   1. LA MEDICIÓN VIEJA SE SIGUE REPORTANDO, con su límite y con su estado. No se
 *      borra, no se reemplaza, no se "corrige". Queda arriba, en el mismo informe, y
 *      dice que está pasada. Si alguna vez este script dejara de imprimirla, la métrica
 *      nueva pierde todo su valor como argumento.
 *
 *   2. EL LÍMITE NUEVO SE DERIVA DEL VIEJO, no se elige para que hoy pase. El límite
 *      viejo le daba al proyecto 1,56x su línea de base (50 sobre 32) y 1,43x su peor
 *      archivo (10 sobre 7). El nuevo usa LOS MISMOS FACTORES sobre la base nueva. O
 *      sea: la misma holgura, medida distinto. No más.
 *
 *   3. SE CLASIFICA CADA CASO Y SE PUEDE IMPRIMIR LA LISTA. Una métrica que devuelve
 *      un número sin poder mostrar de dónde sale no se puede discutir, y por lo tanto
 *      no se puede corregir.
 *
 * ============================================================
 * LA REGLA: QUÉ CUENTA COMO RAMA Y QUÉ NO
 * ============================================================
 *
 * La unidad es LA LÍNEA, igual que el grep documentado, para que los dos números se
 * puedan comparar. Si una línea tiene varias menciones y alguna es rama, la línea es
 * rama.
 *
 * NO CUENTA — DECLARACIÓN. La mención introduce o tipa la bandera; no decide nada.
 *   const esVenue = entityKind === "venue"      la bandera misma
 *   esVenue?: boolean                            un miembro de tipo
 *   esVenue = false,                             un default de destructuring
 *   esVenue: (r.entity_kind as string) === "venue"   un campo que se mapea
 *
 * NO CUENTA — COMENTARIO. No es código. Hay uno, y lo cuenta el grep viejo.
 *
 * NO CUENTA — VOCABULARIO. Un condicional cuyas DOS ramas son solo un literal de
 * string o un template literal. El control de flujo es idéntico en los dos casos: lo
 * único que cambia es la palabra que se imprime o la palabra de una URL.
 *   esVenue ? "venue" : "colectivo"
 *   esVenue ? `/venues/${slug}` : `/colectivos/${slug}`
 *   m.entityKind === "venue" ? " · VENUE" : ""
 *
 *   Separar la tabla NO eliminaría ninguna de estas: seguirían siendo dos textos. Por
 *   eso no son la presión que §5.2 vigila.
 *
 * SÍ CUENTA — RAMA. Todo lo demás. El código hace algo distinto, no dice algo distinto.
 *   if (!esVenue) { ... }                      un camino aparte
 *   {esVenue && ( ... )}                       un bloque que aparece o no
 *   ...(esVenue ? { address, capacity } : {})   campos distintos en el payload
 *   esVenue ? [] : await getInvitaciones(...)   una consulta que se saltea
 *   .filter((c) => c.esVenue === esVenue)       datos que se filtran
 *   useState(esVenue ? destino.name : "")       otro estado inicial
 *
 * LA REGLA ES CONSERVADORA A PROPÓSITO: ante la duda, RAMA. Un ternario con UNA sola
 * rama no-literal cuenta como rama aunque en los hechos sea un placeholder
 * —publicar-evento tiene `esVenue ? destino.name : "Dónde es"`, que es una palabra—
 * porque la alternativa es que el clasificador empiece a opinar sobre qué expresión "es
 * en el fondo" un texto, y ahí la métrica vuelve a ser un juicio. Que el sesgo empuje
 * hacia ARRIBA es lo correcto: una métrica nueva que se equivoca tiene que equivocarse
 * disparando de más, no de menos.
 *
 * ============================================================
 * TRES DEFECTOS DEL COMANDO VIEJO, MEDIDOS
 * ============================================================
 *
 * No cambian la conclusión —60 pasa de 50 con cualquier criterio— pero explican por qué
 * el número no servía para decidir:
 *
 *   CUENTA UN COMENTARIO como si fuera un condicional. El de like-button.tsx dice que
 *   un `if (esVenue)` ahí sería una copia disfrazada: el comentario que explica por qué
 *   NO hay una rama se cuenta como rama. Es la trampa que AGENTS.md advierte en otra
 *   sección, y la comete el comando de AGENTS.md.
 *
 *   CUENTA LÍNEAS Y DICE "condicionales". grep -c cuenta líneas que matchean, no
 *   menciones: hay 68 menciones en 60 líneas, medido con `grep -o | wc -l` y con este
 *   script por separado, que dan lo mismo. La diferencia son las ocho líneas
 *   `const esVenue = entityKind === "venue"`, que matchean los dos patrones a la vez.
 *   Significa que el número nunca fue lo que su nombre decía — y que si alguien
 *   "arreglara" el comando para contar menciones, el total SUBIRÍA a 68 sin que el
 *   código hubiera cambiado una coma.
 *
 *   (La primera versión de este comentario decía 61 de memoria. Lo medido es 68.)
 *
 *   CUENTA 15 DECLARACIONES Y TIPOS, que no pueden ramificar nada.
 */

import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { spawnSync } from "child_process";
import path from "path";

const DETALLE = process.argv.includes("--detalle");

/**
 * El mismo alcance que el comando de AGENTS.md, para que los números se comparen.
 *
 * --alcance <rutas separadas por coma> lo reemplaza, y existe por UNA razón: que la
 * prueba de punta a punta pueda apuntar el pipeline entero a un fixture. Sin eso, lo
 * único que se puede probar del límite es la aritmética, y la aritmética no es donde
 * esto se rompería.
 */
const argAlcance = process.argv.indexOf("--alcance");
const ALCANCE =
  argAlcance !== -1 && process.argv[argAlcance + 1]
    ? process.argv[argAlcance + 1].split(",").filter(Boolean)
    : ["components/", "lib/collectives-write.ts", "lib/db.ts"];
const PATRONES = /\besVenue\b|entityKind === "venue"|kind === "venue"/g;

/** El límite viejo y su línea de base, tal como los fija AGENTS.md. */
const VIEJO = { base: 32, baseArchivos: 7, limiteTotal: 50, limitePorArchivo: 10 };

/**
 * El límite nuevo, DERIVADO del viejo y no elegido.
 *
 *   total:       50 / 32 = 1,5625  ->  19 * 1,5625 = 29,7  ->  30
 *   por archivo: 10 / 7  = 1,4286  ->   5 * 1,4286 =  7,1  ->   7
 *
 * Los dos redondeados hacia abajo desde el número que sale de la proporción, no hacia
 * arriba: si hay que elegir, que el límite sea un poco más exigente y no un poco más
 * flojo que el que reemplaza.
 */
const NUEVO = { limiteTotal: 30, limitePorArchivo: 7 };

/**
 * Se recorre con fs y NO con un grep por shell. La primera versión hacía execSync de
 * grep, y en Windows execSync usa cmd.exe, que no entiende las comillas simples: el
 * patrón se partía y cmd intentaba ejecutar "entityKind" como si fuera un programa. Una
 * métrica que tiene que poder re-correrse en cualquier momento no puede depender de qué
 * shell le toque.
 */
function archivos() {
  const encontrados = [];
  const visitar = (p) => {
    const st = statSync(p);
    if (st.isDirectory()) {
      for (const e of readdirSync(p).sort()) visitar(path.join(p, e));
      return;
    }
    if (!/\.(ts|tsx)$/.test(p)) return;
    const src = readFileSync(p, "utf8");
    if (/\besVenue\b|entityKind === "venue"|kind === "venue"/.test(src)) {
      encontrados.push(p.split(path.sep).join("/"));
    }
  };
  for (const a of ALCANCE) visitar(a.replace(/\/$/, ""));
  return encontrados.sort();
}

/**
 * Marca qué posiciones del texto están dentro de un comentario o de un string. Un
 * escáner de verdad y no un regex, porque "//" adentro de una URL no abre un comentario
 * y `//` adentro de un template literal tampoco.
 */
function mapaDeContexto(src) {
  const comentario = new Uint8Array(src.length);
  let i = 0;
  let estado = "codigo";
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (estado === "codigo") {
      if (c === "/" && d === "/") estado = "linea";
      else if (c === "/" && d === "*") estado = "bloque";
      else if (c === '"' || c === "'" || c === "`") estado = c;
      if (estado === "linea" || estado === "bloque") {
        comentario[i] = 1;
        comentario[i + 1] = 1;
        i += 2;
        continue;
      }
    } else if (estado === "linea") {
      comentario[i] = 1;
      if (c === "\n") estado = "codigo";
    } else if (estado === "bloque") {
      comentario[i] = 1;
      if (c === "*" && d === "/") {
        comentario[i + 1] = 1;
        i += 2;
        estado = "codigo";
        continue;
      }
    } else {
      // dentro de un string: solo importa salir, y respetar el escape
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === estado) estado = "codigo";
    }
    i += 1;
  }
  return comentario;
}

const ABRE = { "(": ")", "[": "]", "{": "}" };
const CIERRA = new Set([")", "]", "}"]);

/**
 * Lee una expresión desde `desde`, parando en el primer `corte` que esté a profundidad
 * 0 y fuera de strings. Devuelve el texto y dónde paró.
 */
function leerExpresion(src, desde, cortes) {
  let i = desde;
  let prof = 0;
  let estado = null;
  while (i < src.length) {
    const c = src[i];
    if (estado) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === estado) estado = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      estado = c;
      i += 1;
      continue;
    }
    if (ABRE[c]) prof += 1;
    else if (CIERRA.has(c)) {
      if (prof === 0) break;
      prof -= 1;
    } else if (prof === 0 && cortes.includes(c)) break;
    i += 1;
  }
  return { texto: src.slice(desde, i), fin: i };
}

/** ¿Es un único literal de string o template? Se permite interpolación. */
function esLiteralDeTexto(txt) {
  const t = txt.trim();
  if (t.length < 2) return false;
  const q = t[0];
  if (q !== '"' && q !== "'" && q !== "`") return false;
  let i = 1;
  while (i < t.length) {
    if (t[i] === "\\") {
      i += 2;
      continue;
    }
    if (t[i] === q) return i === t.length - 1; // cierra justo al final: es UNO solo
    i += 1;
  }
  return false;
}

function clasificarMencion(src, inicio, fin, linea) {
  // Declaración, por la forma de la línea en la que vive.
  const txtLinea = linea.trim();
  if (/^(const|let|var)\s+esVenue\b/.test(txtLinea)) return "DECLARACION";
  if (/^esVenue\s*\??\s*[:=]/.test(txtLinea)) return "DECLARACION";
  // Un miembro de tipo escrito en línea, dentro de un objeto más grande.
  if (/^\s*\??\s*:\s*boolean/.test(src.slice(fin, fin + 20))) return "DECLARACION";

  // ¿Es un ternario? Solo entonces puede ser vocabulario.
  let j = fin;
  while (j < src.length && /\s/.test(src[j])) j += 1;
  if (src[j] !== "?") return "RAMA";

  const a = leerExpresion(src, j + 1, [":"]);
  if (src[a.fin] !== ":") return "RAMA";
  const b = leerExpresion(src, a.fin + 1, [",", ";"]);
  return esLiteralDeTexto(a.texto) && esLiteralDeTexto(b.texto) ? "VOCABULARIO" : "RAMA";
}

const CLASES = ["RAMA", "VOCABULARIO", "DECLARACION", "COMENTARIO"];

/**
 * --probar — LA MÉTRICA SE PRUEBA A SÍ MISMA, Y NO ES OPCIONAL QUE EXISTA.
 *
 * Hoy esta métrica dice "dentro", y ese es justo el resultado que no se puede creer sin
 * más: viene a reemplazar a una que decía "PASADA". Un "dentro" puede significar que el
 * código está bien o que el clasificador no clasifica nada, y esas dos cosas hay que
 * poder distinguirlas. Es el mismo razonamiento que arnes.mjs sobre el barrido que
 * reportaba cero.
 *
 * Así que se ejercitan las dos mitades: que cada forma caiga en la clase que la regla
 * escrita dice, y que los límites DISPAREN cuando se los pasa.
 */
function probar() {
  const casos = [
    // vocabulario: las dos ramas, un literal
    ['const a = esVenue ? "venue" : "colectivo";', "VOCABULARIO"],
    ["const a = esVenue ? `/venues/${s}` : `/colectivos/${s}`;", "VOCABULARIO"],
    ['{m.entityKind === "venue" ? " · VENUE" : ""}', "VOCABULARIO"],
    // rama: una de las dos NO es literal
    ['const a = esVenue ? destino.name : "x";', "RAMA"],
    ["const a = esVenue ? [] : await traer();", "RAMA"],
    ["...(esVenue ? { address } : {}),", "RAMA"],
    // rama: no es ternario
    ["if (!esVenue) { hacer(); }", "RAMA"],
    ["{esVenue && (<Algo />)}", "RAMA"],
    ["const n = !esVenue && otros.length === 0;", "RAMA"],
    ["lista.filter((c) => c.esVenue === esVenue)", "RAMA"],
    // declaración
    ['const esVenue = entityKind === "venue";', "DECLARACION"],
    ["esVenue?: boolean;", "DECLARACION"],
    ["esVenue = false,", "DECLARACION"],
    ["x: Array<{ name: string; esVenue: boolean }>;", "DECLARACION"],
    ['esVenue: (r.entity_kind as string) === "venue",', "DECLARACION"],
    // comentario
    ["// un if (esVenue) acá sería una copia", "COMENTARIO"],
    /**
     * EL FIXTURE LLEVA EL /* QUE ABRE EL BLOQUE, y la primera versión no lo llevaba: le
     * pasaba solo la línea interior —" * `if (esVenue)` ..."— y el chequeo daba MAL. No
     * era el clasificador: sin el abre-bloque, el escáner ve el backtick y entra en
     * estado de template literal, que es exactamente lo que tiene que hacer. Sobre el
     * archivo real, donde el /* está, clasifica bien (like-button.tsx:15 sale
     * COMENTARIO).
     *
     * Vale como regla para cualquier fixture de este script: el escáner lee ESTADO
     * acumulado desde el principio del archivo, así que un fragmento tiene que ser
     * válido por sí solo o la prueba mide otra cosa.
     */
    ["/*\n * `if (esVenue)` adentro sería una copia\n */", "COMENTARIO"],
    // un string que CONTIENE la palabra no es una rama
    ['const t = "ojo con esVenue acá";', "COMENTARIO_O_STRING"],
  ];

  let ok = 0;
  let mal = 0;
  const decir = (bien, texto) => {
    if (bien) {
      ok += 1;
      console.log(`   OK   ${texto}`);
    } else {
      mal += 1;
      console.log(`   MAL  ${texto}`);
    }
  };

  console.log("=== CADA FORMA CAE EN SU CLASE ===");
  for (const [src, esperada] of casos) {
    const comentario = mapaDeContexto(src);
    PATRONES.lastIndex = 0;
    const m = PATRONES.exec(src);
    if (!m) {
      decir(false, `no matcheó nada: ${src}`);
      continue;
    }
    let clase;
    if (comentario[m.index]) clase = "COMENTARIO";
    else clase = clasificarMencion(src, m.index, m.index + m[0].length, src);
    if (esperada === "COMENTARIO_O_STRING") {
      /**
       * UN STRING NO ES UN COMENTARIO, Y ESTA ES LA LIMITACIÓN CONOCIDA. El mapa marca
       * comentarios, no literales, así que la palabra adentro de un string se clasifica
       * por su forma y acá cae en RAMA. No hay ningún caso así en el código de hoy
       * —verificado— y si apareciera, inflaría el número, no lo bajaría. Queda medido en
       * vez de escondido.
       */
      decir(clase === "RAMA", `un string con la palabra adentro cae en RAMA (limitación conocida)`);
      continue;
    }
    decir(clase === esperada, `${esperada.padEnd(12)} ${src.slice(0, 58)}`);
  }

  console.log("\n=== LOS LÍMITES DISPARAN ===");
  const fuegoTotal = (n) => n > NUEVO.limiteTotal;
  const fuegoArchivo = (n) => n > NUEVO.limitePorArchivo;
  decir(!fuegoTotal(NUEVO.limiteTotal), `${NUEVO.limiteTotal} ramas en total: NO dispara`);
  decir(fuegoTotal(NUEVO.limiteTotal + 1), `${NUEVO.limiteTotal + 1} ramas en total: DISPARA`);
  decir(!fuegoArchivo(NUEVO.limitePorArchivo), `${NUEVO.limitePorArchivo} en un archivo: NO dispara`);
  decir(fuegoArchivo(NUEVO.limitePorArchivo + 1), `${NUEVO.limitePorArchivo + 1} en un archivo: DISPARA`);
  decir(
    NUEVO.limiteTotal < VIEJO.limiteTotal && NUEVO.limitePorArchivo < VIEJO.limitePorArchivo,
    "el límite nuevo es MÁS exigente que el viejo en los dos ejes"
  );

  /**
   * DE PUNTA A PUNTA, SOBRE CÓDIGO DE VERDAD. Esto es lo que contesta la objeción de
   * fondo: que la métrica nueva diga "dentro" podría ser porque el código está bien o
   * porque el pipeline no encuentra nada. Se le apunta a un fixture con 8 ramas en un
   * solo archivo y tiene que salir con 1 y nombrarlo.
   */
  console.log("\n=== EL PIPELINE COMPLETO DISPARA SOBRE CÓDIGO REAL ===");
  const dir = mkdtempSync(path.join(tmpdir(), "metrica-ek-"));
  const fixture = path.join(dir, "demasiadas-ramas.tsx");
  writeFileSync(
    fixture,
    [
      'const esVenue = entityKind === "venue";',
      'const palabra = esVenue ? "venue" : "colectivo";', // vocabulario, no cuenta
      "if (!esVenue) { uno(); }",
      "if (esVenue) { dos(); }",
      "const a = esVenue ? [] : await tres();",
      "const b = !esVenue && cuatro.length === 0;",
      "const c = { ...(esVenue ? { cinco: 1 } : {}) };",
      "const d = lista.filter((x) => x.esVenue === esVenue);",
      "const e = esVenue ? seis() : siete();",
      "const f = esVenue ? ocho : nueve;",
      "",
    ].join("\n"),
    "utf8"
  );
  const r = spawnSync(process.execPath, [process.argv[1], "--alcance", dir], {
    encoding: "utf8",
  });
  const salida = `${r.stdout}${r.stderr}`;
  decir(r.status === 1, "sale con código 1 cuando un archivo se pasa del límite");
  decir(/PASADA/.test(salida), "y lo dice con la palabra PASADA");
  decir(salida.includes("demasiadas-ramas.tsx"), "y NOMBRA el archivo culpable");
  decir(/\b8\b/.test(salida), "y cuenta las 8 ramas, sin contar el vocabulario ni la declaración");
  decir(
    /LA MEDICIÓN VIEJA/.test(salida),
    "y SIGUE imprimiendo la medición vieja: la nueva no la reemplaza nunca"
  );
  rmSync(dir, { recursive: true, force: true });

  console.log(`\n=== ${ok} OK, ${mal} MAL ===`);
  process.exit(mal === 0 ? 0 : 1);
}

if (process.argv.includes("--probar")) probar();
const porArchivo = new Map();
const todas = [];
let mencionesTotales = 0;

for (const f of archivos()) {
  const src = readFileSync(f, "utf8").replace(/\r\n/g, "\n");
  const comentario = mapaDeContexto(src);
  const lineas = src.split("\n");
  const inicioDeLinea = [];
  let acc = 0;
  for (const l of lineas) {
    inicioDeLinea.push(acc);
    acc += l.length + 1;
  }
  const claseDeLinea = new Map();

  PATRONES.lastIndex = 0;
  let m;
  while ((m = PATRONES.exec(src)) !== null) {
    mencionesTotales += 1;
    const inicio = m.index;
    let nl = 0;
    while (nl + 1 < inicioDeLinea.length && inicioDeLinea[nl + 1] <= inicio) nl += 1;
    const clase = comentario[inicio]
      ? "COMENTARIO"
      : clasificarMencion(src, inicio, inicio + m[0].length, lineas[nl]);
    // La línea se queda con la clase MÁS grave de sus menciones.
    const previa = claseDeLinea.get(nl);
    if (previa === undefined || CLASES.indexOf(clase) < CLASES.indexOf(previa)) {
      claseDeLinea.set(nl, clase);
    }
  }

  const cuenta = { RAMA: 0, VOCABULARIO: 0, DECLARACION: 0, COMENTARIO: 0 };
  for (const [nl, clase] of [...claseDeLinea.entries()].sort((x, y) => x[0] - y[0])) {
    cuenta[clase] += 1;
    todas.push({ archivo: f, linea: nl + 1, clase, texto: lineas[nl].trim() });
  }
  porArchivo.set(f, cuenta);
}

const tot = { RAMA: 0, VOCABULARIO: 0, DECLARACION: 0, COMENTARIO: 0 };
for (const c of porArchivo.values()) for (const k of CLASES) tot[k] += c[k];
const lineasTotales = tot.RAMA + tot.VOCABULARIO + tot.DECLARACION + tot.COMENTARIO;

if (DETALLE) {
  let actual = "";
  for (const o of todas) {
    if (o.archivo !== actual) {
      actual = o.archivo;
      console.log(`\n${actual}`);
    }
    const t = o.texto.length > 86 ? o.texto.slice(0, 83) + "..." : o.texto;
    console.log(`  ${String(o.linea).padStart(4)}  ${o.clase.padEnd(12)}  ${t}`);
  }
  console.log("");
}

console.log("=== LA MEDICIÓN VIEJA, QUE SIGUE VALIENDO ===");
console.log(`  líneas que matchean: ${lineasTotales}   (menciones: ${mencionesTotales})`);
console.log(`  archivos: ${porArchivo.size}`);
const peorViejo = [...porArchivo.entries()]
  .map(([f, c]) => [f, CLASES.reduce((s, k) => s + c[k], 0)])
  .sort((a, b) => b[1] - a[1])[0];
console.log(`  peor archivo: ${peorViejo[0]} con ${peorViejo[1]}`);
console.log(
  `  línea de base: ${VIEJO.base} en ${VIEJO.baseArchivos} archivos   ` +
    `límites: ${VIEJO.limiteTotal} total / ${VIEJO.limitePorArchivo} por archivo`
);
const vTotal = lineasTotales > VIEJO.limiteTotal;
const vArchivo = peorViejo[1] > VIEJO.limitePorArchivo;
console.log(`  ESTADO: ${vTotal || vArchivo ? "PASADA" : "dentro"}` +
  (vTotal ? ` (total ${lineasTotales} > ${VIEJO.limiteTotal})` : "") +
  (vArchivo ? ` (un archivo ${peorViejo[1]} > ${VIEJO.limitePorArchivo})` : ""));
console.log("  DECISIÓN TOMADA: no separar venue de colectivo. Queda escrito, no borrado.");

console.log("\n=== DE QUÉ ESTÁN HECHAS ESAS LÍNEAS ===");
for (const k of CLASES) console.log(`  ${k.padEnd(12)} ${String(tot[k]).padStart(3)}`);

console.log("\n=== LA MEDICIÓN NUEVA: SOLO RAMAS ===");
const ramas = [...porArchivo.entries()]
  .map(([f, c]) => [f, c.RAMA])
  .filter(([, n]) => n > 0)
  .sort((a, b) => b[1] - a[1]);
for (const [f, n] of ramas) console.log(`  ${String(n).padStart(3)}  ${f}`);
console.log(`  total: ${tot.RAMA} ramas en ${ramas.length} archivos`);
console.log(
  `  límites derivados: ${NUEVO.limiteTotal} total / ${NUEVO.limitePorArchivo} por archivo`
);

const nTotal = tot.RAMA > NUEVO.limiteTotal;
const nArchivo = ramas.length > 0 && ramas[0][1] > NUEVO.limitePorArchivo;
const pasada = nTotal || nArchivo;
console.log(
  `  ESTADO: ${pasada ? "PASADA — volver a mirar si conviene separar" : "dentro"}` +
    (nTotal ? ` (total ${tot.RAMA} > ${NUEVO.limiteTotal})` : "") +
    (nArchivo ? ` (${ramas[0][0]} con ${ramas[0][1]} > ${NUEVO.limitePorArchivo})` : "")
);

process.exit(pasada ? 1 : 0);
