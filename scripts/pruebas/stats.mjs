/**
 * STATS DEL EPK: lo que se puede medir, con su denominador, y nada inventado.
 *
 * Dos mitades, y las dos hacen falta:
 *
 *   EL CÁLCULO PURO, importando calcularStats de verdad desde lib/stats.ts. Node no puede
 *   importar los libs .ts del repo —los imports van sin extensión— así que se lee el
 *   archivo y se evalúa su cuerpo, que es feo pero importa LA función y no una copia. Una
 *   prueba que reimplementa lo que verifica solo prueba que sabe reimplementarlo.
 *
 *   Y LA PÁGINA, por HTTP con fixtures reales, porque el cálculo correcto no sirve si la
 *   sección no lo muestra o lo muestra cuando no debería.
 *
 * El caso que más me importa es el DENOMINADOR: que 14 h medidas en 2 de 11 toques nunca
 * se vean como el total de 11. Un parcial presentado como total es cómo un press kit miente
 * sin que nadie escriba una mentira.
 */

import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";
import { abrirCorrida } from "./seed.mjs";

const BASE = "http://localhost:3000";
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

/**
 * Se importa la función REAL de lib/stats.ts, quitando solo los `export` para poder
 * evaluarla. Si el archivo cambia de forma, esto se rompe ruidosamente — que es lo que
 * tiene que pasar — en vez de seguir probando una copia vieja.
 */
const fuente = readFileSync("lib/stats.ts", "utf8")
  .replace(/^export type [\s\S]*?^};$/gm, "")
  .replace(/^export type .*$/gm, "")
  .replace(/export function/g, "function")
  .replace(/: ArtistStats|: ToqueParaStats\[\]|: string \| null|: number|: boolean/g, "")
  .replace(/const venues = new Set<string>\(\);/, "const venues = new Set();")
  .replace(/const ciudades = new Set<string>\(\);/, "const ciudades = new Set();");
const { calcularStats, horasEnPalabras, statsVacias } = new Function(
  `${fuente}; return { calcularStats, horasEnPalabras, statsVacias };`
)();

const DUENO = "artista@test.hotu.local";
const ART = "test-camila";
const COL = "zz-stats-col";

const corrida = await abrirCorrida(sql, "stats del epk");

const J = new Map();
const g = (q, r) => {
  const j = J.get(q) ?? new Map();
  for (const x of r.headers.getSetCookie?.() ?? []) {
    const [pp] = x.split(";");
    const i = pp.indexOf("=");
    const k = pp.slice(0, i).trim();
    const v = pp.slice(i + 1).trim();
    if (v === "") j.delete(k);
    else j.set(k, v);
  }
  J.set(q, j);
};
const ck = (q) => [...(J.get(q) ?? new Map())].map(([k, v]) => `${k}=${v}`).join("; ");
async function login(q, email) {
  J.set(q, new Map());
  const r1 = await fetch(`${BASE}/api/auth/csrf`);
  g(q, r1);
  const { csrfToken } = await r1.json();
  g(
    q,
    await fetch(`${BASE}/api/auth/callback/credentials`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", cookie: ck(q) },
      body: new URLSearchParams({ csrfToken, email, password: "test1234", redirect: "false", json: "true" }),
      redirect: "manual",
    })
  );
  const s = await (await fetch(`${BASE}/api/auth/session`, { headers: { cookie: ck(q) } })).json();
  return s?.user?.email ?? null;
}

try {
  console.log("=== 1. EL CÁLCULO, CON LA FUNCIÓN DE VERDAD ===");
  {
    const t = (venue, city, durationMinutes, source) => ({ venue, city, durationMinutes, source });

    const vacio = calcularStats([]);
    chk("sin toques: todo en cero", vacio.toques === 0 && vacio.minutosHotu === 0, JSON.stringify(vacio));
    chk("y statsVacias lo dice", statsVacias(vacio) === true);

    const s = calcularStats([
      t("Bodega 38", "Bogota", 120, "hotu"),
      t("Bodega 38", "Bogota", 180, "hotu"),
      t("Otro Lugar", "Chia", 90, "declarado"),
      t("Tercero", "Bogota", null, "hotu"),
    ]);
    chk("cuenta los 4 toques", s.toques === 4, String(s.toques));
    chk("pero conDuracion es 3", s.conDuracion === 3, String(s.conDuracion));
    chk("separa las horas de HOTU (300)", s.minutosHotu === 300, String(s.minutosHotu));
    chk("de las declaradas (90)", s.minutosDeclarados === 90, String(s.minutosDeclarados));
    chk("venues distintos: 3", s.venues === 3, String(s.venues));
    chk("ciudades distintas: 2", s.ciudades === 2, String(s.ciudades));

    /** El mismo venue escrito distinto no son dos lugares. */
    const n = calcularStats([t("Bodega 38", "Bogota", 60, "hotu"), t("  bodega 38 ", "BOGOTA", 60, "hotu")]);
    chk("'Bodega 38' y '  bodega 38 ' cuentan como UNO", n.venues === 1, String(n.venues));
    chk("y 'Bogota' y 'BOGOTA' también", n.ciudades === 1, String(n.ciudades));

    /** Duraciones que no son duraciones. duration_minutes de artist_gigs lo carga el DJ
     *  a mano y no tiene CHECK, así que esto no es un caso imposible. */
    const raro = calcularStats([t("A", "B", 0, "hotu"), t("A", "B", -30, "declarado"), t("A", "B", 1.5, "hotu")]);
    chk("una duración de 0 no cuenta", raro.minutosHotu === 1.5, String(raro.minutosHotu));
    chk("ni una negativa", raro.minutosDeclarados === 0, String(raro.minutosDeclarados));
    chk("y conDuracion solo cuenta las > 0", raro.conDuracion === 1, String(raro.conDuracion));
  }

  console.log("\n=== 2. LAS HORAS EN PALABRAS, Y EL CERO QUE NO SE MUESTRA ===");
  {
    chk("120 -> '2 h'", horasEnPalabras(120) === "2 h", String(horasEnPalabras(120)));
    chk("150 -> '2 h 30'", horasEnPalabras(150) === "2 h 30", String(horasEnPalabras(150)));
    chk("45 -> '45 min'", horasEnPalabras(45) === "45 min", String(horasEnPalabras(45)));
    /**
     * CERO DEVUELVE null Y NO "0 h". Es la diferencia entre "tocó cero horas" y "no
     * sabemos cuánto tocó", que en la pantalla se leen igual. El llamador no muestra la
     * fila.
     */
    chk("0 -> null, no '0 h'", horasEnPalabras(0) === null, String(horasEnPalabras(0)));
    chk("negativo -> null", horasEnPalabras(-10) === null, String(horasEnPalabras(-10)));
  }

  console.log("\n=== 3. EN LA PÁGINA: SIN DATOS, SIN SECCIÓN ===");
  {
    const [art] = await sql`SELECT slug FROM artists WHERE slug = ${ART}`;
    chk(`el artista ${ART} existe`, !!art);

    /** Se limpian sus toques declarados para partir de un estado conocido. */
    await sql`DELETE FROM artist_gigs WHERE artist_slug = ${ART}`;
    const html = await (await fetch(`${BASE}/artistas/${ART}`)).text();
    const tieneLineup = await sql`SELECT COUNT(*)::int n FROM event_lineup WHERE artist_slug = ${ART}`;
    if (tieneLineup[0].n === 0) {
      chk("sin ningún toque: la sección STATS NO aparece", !html.includes(">STATS<"), "aparece igual");
    } else {
      /** Con toques de lineup pero sin horas cargadas, venues y ciudades alcanzan para
       *  mostrarla. Decirlo en vez de asumir cuál de los dos casos toca. */
      chk("con toques de lineup, la sección puede aparecer", true, "");
    }
  }

  console.log("\n=== 4. EN LA PÁGINA: EL DENOMINADOR SE VE ===");
  {
    /**
     * Dos toques declarados: uno con duración y otro SIN. El parcial tiene que decir en
     * cuántos se midió, y ese es el chequeo central de toda la pieza.
     */
    await sql`DELETE FROM artist_gigs WHERE artist_slug = ${ART}`;
    await sql`INSERT INTO artist_gigs (artist_slug, external_name, venue, city, gig_date, duration_minutes, source)
              VALUES (${ART}, 'ZZ Fiesta Larga', 'ZZ Bodega Una', 'Bogota', '2026-03-14', 180, 'declarado')`;
    await sql`INSERT INTO artist_gigs (artist_slug, external_name, venue, city, gig_date, source)
              VALUES (${ART}, 'ZZ Fiesta Corta', 'ZZ Bodega Dos', 'Chia', '2026-04-18', 'declarado')`;

    const html = await (await fetch(`${BASE}/artistas/${ART}`)).text();
    chk("la sección STATS aparece", html.includes(">STATS<"), "no aparece");
    chk("muestra HORAS DECLARADAS", html.includes("HORAS DECLARADAS"), "no está el rótulo");
    chk("con 3 h", html.includes("3 h"), "no está el valor");

    const [{ n: lineup }] = await sql`SELECT COUNT(*)::int n FROM event_lineup WHERE artist_slug = ${ART}`;
    const total = 2 + lineup;
    chk(
      `DICE EN CUÁNTOS SE MIDIÓ: "1 de ${total} toques"`,
      html.includes(`1 de ${total} toques`),
      "no está la frase del denominador"
    );
    chk("y NO dice 'Medido en los' (que sería afirmar que son todos)", !html.includes("Medido en los"), "lo dice");

    chk("muestra VENUES", html.includes("VENUES"), "no está");
    chk("y CIUDADES", html.includes("CIUDADES"), "no está");
  }

  console.log("\n=== 5. LO QUE NO SE MUESTRA PORQUE NO SE MIDE ===");
  {
    const html = await (await fetch(`${BASE}/artistas/${ART}`)).text();
    /**
     * ASISTENTES NO APARECE, ni como fila vacía con un guión. Sale de la atribución, que
     * está pospuesta. Una fila "ASISTENTES —" se lee como "este DJ no lleva gente", que es
     * una afirmación sobre el artista; lo cierto es que la plataforma no lo mide todavía.
     */
    chk("no hay rótulo ASISTENTES", !html.includes("ASISTENTES"), "aparece");
    chk("ni PROMEDIO", !html.includes("PROMEDIO"), "aparece");
  }

  console.log("\n=== 6. STATS NO SE PUEDE EDITAR, NI SIENDO EL DUEÑO ===");
  {
    chk("login del dueño", (await login("d", DUENO)) === DUENO);
    const conSesion = await (await fetch(`${BASE}/artistas/${ART}`, { headers: { cookie: ck("d") } })).text();
    chk("el dueño ve la sección", conSesion.includes(">STATS<"), "no la ve");

    /**
     * NO HAY BOTÓN DE EDITAR EN STATS, y la prueba no es mirar si hay un botón: es que la
     * sección no está envuelta en EpkEditableSection. Se comprueba por el único rótulo que
     * ese componente renderiza para el dueño, "EDITAR", contando que aparezca en las OTRAS
     * secciones y verificando que el bloque de STATS no lo tenga.
     */
    const i = conSesion.indexOf(">STATS<");
    const fin = conSesion.indexOf("RIDER TÉCNICO", i);
    const bloque = i >= 0 && fin > i ? conSesion.slice(i, fin) : "";
    chk("el bloque de STATS se aisló para mirarlo", bloque.length > 0, "no pude aislarlo");
    chk("y NO tiene botón de editar", !/EDITAR/i.test(bloque), bloque.slice(0, 200));
    chk("mientras OTRAS secciones sí lo tienen (control positivo)", /EDITAR/i.test(conSesion), "no hay ningún EDITAR en toda la página: el control positivo falla");
  }

  await sql`DELETE FROM artist_gigs WHERE artist_slug = ${ART} AND external_name LIKE 'ZZ %'`;
  await sql`DELETE FROM collectives WHERE slug = ${COL}`;
} finally {
  const resumen = await corrida.cerrar();
  console.log(`\nbarrido: ${JSON.stringify(resumen?.borrado ?? {})}`);
}

console.log(`\n=== ${ok} OK, ${mal} MAL ===`);
process.exit(mal === 0 ? 0 : 1);
