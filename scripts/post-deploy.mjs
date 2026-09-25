/**
 * EL CHEQUEO POST-DEPLOY. Dos preguntas, en el orden en que importan.
 *
 *   node scripts/post-deploy.mjs
 *   node scripts/post-deploy.mjs --base https://hotu-one.vercel.app
 *
 * ============================================================
 * 1. ¿SE ROMPE ALGUNA LECTURA EN PRODUCCIÓN? (/api/smoke)
 * ============================================================
 *
 * Es la pregunta que importa y la que nadie estaba haciendo. /admin estuvo
 * 500 durante 66 commits porque la verificación post-deploy pedía URLs, y
 * el middleware contesta 307 a /admin/* antes de renderizar. El 307
 * llegaba y se leía como "anda".
 *
 * ============================================================
 * 2. ¿EN QUÉ SE DIFERENCIA EL ESQUEMA? (/api/schema-fingerprint)
 * ============================================================
 *
 * Esto NO reemplaza al smoke: un diff no sabe qué columnas usa el código.
 * Sirve para lo otro — cuando el smoke falla, decir DÓNDE mirar; y para
 * ver una migración pendiente antes de que rompa algo.
 *
 * Y no todas las diferencias son un problema: zz_test_lock existe solo en
 * dev a propósito. Por eso lo que FALLA es que a main le falte una
 * COLUMNA de una tabla que existe en las dos, o que una columna tenga otra
 * forma. Lo demás se informa.
 *
 * ============================================================
 * LAS LLAVES
 * ============================================================
 *
 * SMOKE_SECRET (dev, en .env.local) y SMOKE_SECRET_MAIN (el de Vercel,
 * también en .env.local). NO son MIGRATE_SECRET: esas dos rutas solo leen,
 * y tener la llave de migraciones a mano para correr una verificación que
 * se usa después de cada deploy es cómo una credencial peligrosa termina
 * en todos lados.
 *
 * Sale con código distinto de cero si algo está roto, así que sirve de
 * puerta: `node scripts/post-deploy.mjs || echo NO DESPLEGAR MÁS`.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* =================================================================
 * EL COMPARADOR, EXPORTADO PARA PODER PROBARLO
 *
 * Vive acá y se exporta en vez de estar embebido en el cuerpo del script
 * porque la rama que importa —"a main le falta una columna"— no se puede
 * ejercitar comparando dev contra dev. La prueba le pasa dos huellas
 * adulteradas y verifica los hallazgos, y así prueba ESTE código y no una
 * copia parecida.
 * ================================================================= */

/**
 * @param {{tablas: Record<string, Record<string,string>>}} dev
 * @param {{tablas: Record<string, Record<string,string>>}} main
 */
export function compararEsquemas(dev, main) {
  const D = dev?.tablas ?? {};
  const M = main?.tablas ?? {};

  const soloDev = Object.keys(D).filter((t) => !(t in M));
  const soloMain = Object.keys(M).filter((t) => !(t in D));

  /**
   * LO QUE FALLA: a main le falta una columna de una tabla que las dos
   * tienen. Es exactamente la forma del caso de artists.submitted_at.
   *
   * Una tabla entera que falte en main se informa pero no falla sola:
   * zz_test_lock es de pruebas y no tiene por qué existir allá. Si de
   * verdad falta una tabla que el código usa, el SMOKE lo grita, y ese es
   * el chequeo que manda.
   */
  const faltantes = [];
  const distintas = [];
  for (const t of Object.keys(D)) {
    if (!(t in M)) continue;
    for (const c of Object.keys(D[t])) {
      if (!(c in M[t])) {
        faltantes.push(`${t}.${c}`);
      } else if (D[t][c] !== M[t][c]) {
        distintas.push({ columna: `${t}.${c}`, dev: D[t][c], main: M[t][c] });
      }
    }
  }

  return {
    soloDev,
    soloMain,
    faltantes,
    distintas,
    /** true si main puede quedarse atrás de lo que el código espera. */
    hayProblema: faltantes.length > 0 || distintas.length > 0,
  };
}

/* =================================================================
 * CLI
 * ================================================================= */
const esteArchivo = fileURLToPath(import.meta.url);
const invocadoDirecto =
  process.argv[1] && process.argv[1].replace(/\\/g, "/") === esteArchivo.replace(/\\/g, "/");

if (invocadoDirecto) {
  const env = {};
  try {
    for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
      if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    console.error("No pude leer .env.local");
    process.exit(2);
  }

  const arg = (nombre, defecto) => {
    const i = process.argv.indexOf(nombre);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : defecto;
  };

  const BASE = arg("--base", "https://hotu-one.vercel.app").replace(/\/$/, "");
  const DEV = arg("--dev", "http://localhost:3000").replace(/\/$/, "");
  const SECRET_MAIN = arg("--secret-main", env.SMOKE_SECRET_MAIN ?? "");
  const SECRET_DEV = arg("--secret-dev", env.SMOKE_SECRET ?? "");

  if (!SECRET_MAIN) {
    console.error(
      "Falta SMOKE_SECRET_MAIN en .env.local (o pasalo con --secret-main XXX).\n" +
        "NO uso SMOKE_SECRET para main: si los secretos difieren, reusarlo daría\n" +
        "un 401 que se lee como 'la ruta no está desplegada'."
    );
    process.exit(2);
  }

  let fallas = 0;
  const pedir = async (url) => {
    try {
      const res = await fetch(url);
      let data = null;
      try {
        data = await res.json();
      } catch {
        /* se reporta por el status */
      }
      return { status: res.status, data };
    } catch (e) {
      return { status: 0, data: null, error: e instanceof Error ? e.message : String(e) };
    }
  };

  /* ---------- 1. EL SMOKE ---------- */
  console.log("=== 1. LECTURAS EN PRODUCCIÓN ===");
  {
    const r = await pedir(`${BASE}/api/smoke?secret=${encodeURIComponent(SECRET_MAIN)}`);

    if (r.status === 401) {
      console.log("  FALLA: 401. SMOKE_SECRET_MAIN no coincide con el SMOKE_SECRET de Vercel.");
      fallas++;
    } else if (r.status === 404) {
      console.log("  FALLA: 404. /api/smoke todavía no está desplegado.");
      fallas++;
    } else if (!r.data) {
      console.log(`  FALLA: HTTP ${r.status} sin JSON.${r.error ? " " + r.error : ""}`);
      fallas++;
    } else {
      console.log(
        `  HTTP ${r.status} · ${r.data.lecturas} lecturas · ${r.data.rotas} rotas · ${r.data.omitidas} omitidas`
      );
      for (const x of r.data.roto ?? []) {
        console.log(`  ROTO  ${x.pagina}  ${x.lector}`);
        console.log(`        ${x.error}`);
      }
      for (const x of (r.data.resultados ?? []).filter((y) => y.omitido)) {
        console.log(`  OMIT  ${x.pagina}  ${x.lector} — ${x.omitido}`);
      }
      console.log(`  sanas:   ${(r.data.sanas ?? []).join(" ") || "ninguna"}`);
      if ((r.data.dudosas ?? []).length > 0) {
        console.log(`  dudosas: ${r.data.dudosas.join(" ")}  <- de estas este resultado NO habla`);
      }
      if (r.data.ok !== true) fallas++;
    }
  }

  /* ---------- 2. LA DERIVA DE ESQUEMA ---------- */
  console.log("\n=== 2. DEV CONTRA MAIN ===");
  {
    const dev = SECRET_DEV
      ? await pedir(`${DEV}/api/schema-fingerprint?secret=${encodeURIComponent(SECRET_DEV)}`)
      : { status: 0, data: null };
    const main = await pedir(`${BASE}/api/schema-fingerprint?secret=${encodeURIComponent(SECRET_MAIN)}`);

    if (!dev.data?.ok) {
      console.log(
        `  no pude leer dev (HTTP ${dev.status}). ¿Está levantado el server con npm run dev,\n` +
          "  y SMOKE_SECRET en .env.local?\n" +
          "  SIN COMPARACIÓN: esto no es un OK, es una pregunta sin responder."
      );
      fallas++;
    } else if (!main.data?.ok) {
      console.log(`  no pude leer main (HTTP ${main.status}).`);
      fallas++;
    } else {
      console.log(
        `  dev:  ${dev.data.resumen.tablas} tablas, ${dev.data.resumen.columnas} columnas\n` +
          `  main: ${main.data.resumen.tablas} tablas, ${main.data.resumen.columnas} columnas`
      );

      const d = compararEsquemas(dev.data, main.data);
      if (d.soloDev.length) console.log(`  tablas solo en dev:  ${d.soloDev.join(", ")}`);
      if (d.soloMain.length) console.log(`  tablas solo en main: ${d.soloMain.join(", ")}`);
      for (const c of d.faltantes) console.log(`  FALTA EN MAIN: ${c}`);
      for (const x of d.distintas) {
        console.log(`  FORMA DISTINTA: ${x.columna}\n        dev:  ${x.dev}\n        main: ${x.main}`);
      }

      if (d.faltantes.length > 0) {
        console.log(
          `  -> ${d.faltantes.length} columna(s) faltan en main. Falta correr una migración allá.`
        );
        fallas++;
      }
      if (d.distintas.length > 0) {
        console.log(
          `  -> ${d.distintas.length} columna(s) con otra forma. Miralas: un default o un NOT NULL ` +
            "distinto cambia el comportamiento sin romper nada."
        );
        fallas++;
      }
      if (!d.hayProblema) console.log("  ninguna columna falta ni difiere en forma.");
    }
  }

  console.log();
  if (fallas === 0) {
    console.log("TODO BIEN. Las lecturas corren en producción y el esquema no tiene deriva.");
    process.exit(0);
  }
  console.log(`${fallas} problema(s). NO sigas desplegando sin mirarlos.`);
  process.exit(1);
}
