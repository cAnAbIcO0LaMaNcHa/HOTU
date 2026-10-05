/**
 * LA RETENCIÓN DE mail_outbox: 90 DÍAS DE CONTENIDO, REGISTRO PARA SIEMPRE.
 *
 * Lo que de verdad hay que medir, en orden de cuánto me preocupa:
 *
 *   QUE EL REGISTRO SOBREVIVA. Es la mitad que un DELETE se habría llevado y que hace que
 *   esto no sea un borrado: después de purgar, tipo, para, estado y creado_en tienen que
 *   seguir ahí. Si se van, HOTU no puede demostrar que avisó, que es el reclamo del que la
 *   tabla protege.
 *
 *   QUE EL PLAZO SE RESPETE EN LOS DOS BORDES. Una fila de 91 días se purga; una de 89 NO.
 *   Un off-by-one acá borra contenido antes de tiempo, y no se recupera.
 *
 *   QUE EL CHECK IMPIDA LOS ESTADOS INTERMEDIOS, que son los que aparecen si una purga se
 *   cae a mitad: purgado_en escrito con el cuerpo todavía ahí, o el cuerpo vacío sin decir
 *   que se purgó.
 *
 *   Y LA IDEMPOTENCIA, que acá significa algo preciso: la segunda corrida tiene que purgar
 *   CERO. Si volviera a contar las mismas filas, el número "purgadas" mentiría para siempre.
 */

import { neon } from "@neondatabase/serverless";
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

const SECRETO = process.env.MIGRATE_SECRET;
const purga = async (qs = "") => {
  const r = await fetch(`${BASE}/api/mantenimiento-mail-outbox?secret=${SECRETO}${qs}`);
  return { status: r.status, data: await r.json().catch(() => ({})) };
};

/** Mete una fila con una edad dada, saltándose el write path: lo que se prueba es la purga,
 *  no cómo se encoló. El prefijo zz- la hace reconocible. */
const encolar = async (dias, marca) => {
  const [f] = await sql`
    INSERT INTO mail_outbox (tipo, para, asunto, cuerpo, estado, creado_en)
    VALUES ('zz-prueba', ${`zz-${marca}@test.hotu.local`}, ${`ZZ Asunto ${marca}`},
            ${`ZZ Cuerpo ${marca} con texto que es dato personal.`}, 'registrado',
            now() - (${dias} || ' days')::interval)
    RETURNING id`;
  return f.id;
};

const corrida = await abrirCorrida(sql, "retencion de mail_outbox");

try {
  chk("MIGRATE_SECRET está en el entorno", Boolean(SECRETO), "sin el secreto no se puede probar la ruta");

  console.log("\n=== 1. EL ESQUEMA ESTÁ, Y EL CHECK ATA LAS TRES ===");
  {
    const cols = await sql`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name='mail_outbox'
        AND column_name IN ('asunto','cuerpo','purgado_en')`;
    const m = Object.fromEntries(cols.map((c) => [c.column_name, c.is_nullable]));
    chk("asunto acepta NULL", m.asunto === "YES", m.asunto);
    chk("cuerpo acepta NULL", m.cuerpo === "YES", m.cuerpo);
    chk("purgado_en existe", m.purgado_en === "YES", JSON.stringify(m));

    /** Los dos estados intermedios que el CHECK tiene que rechazar. */
    const id = await encolar(1, "intermedio");
    let a = "entró";
    try {
      await sql`UPDATE mail_outbox SET purgado_en = now() WHERE id = ${id}`;
    } catch (e) {
      a = String(e?.code ?? "error");
    }
    chk("purgado_en CON cuerpo todavía ahí -> la base lo rechaza", a !== "entró", a);

    let b = "entró";
    try {
      await sql`UPDATE mail_outbox SET asunto = NULL, cuerpo = NULL WHERE id = ${id}`;
    } catch (e) {
      b = String(e?.code ?? "error");
    }
    chk("cuerpo vacío SIN purgado_en -> la base lo rechaza", b !== "entró", b);

    /** Y el estado bueno sí entra: las tres juntas. */
    let c = "falló";
    try {
      await sql`UPDATE mail_outbox SET asunto = NULL, cuerpo = NULL, purgado_en = now() WHERE id = ${id}`;
      c = "entró";
    } catch (e) {
      c = String(e?.code ?? e).slice(0, 40);
    }
    chk("las tres juntas SÍ entran", c === "entró", c);
    await sql`DELETE FROM mail_outbox WHERE id = ${id}`;
  }

  console.log("\n=== 2. EL PLAZO, EN LOS DOS BORDES ===");
  {
    await sql`DELETE FROM mail_outbox WHERE tipo = 'zz-prueba'`;
    const vieja = await encolar(91, "vieja");
    const borde = await encolar(89, "borde");
    const nueva = await encolar(1, "nueva");

    const seca = await purga("&dryRun=1");
    chk("el dryRun responde 200", seca.status === 200, JSON.stringify(seca).slice(0, 120));
    chk("y dice que purgaría UNA", seca.data?.purgadas === 1, JSON.stringify(seca.data?.purgadas));

    /** Y no tocó nada: es la mitad del punto de tener dryRun. */
    const [sigue] = await sql`SELECT cuerpo FROM mail_outbox WHERE id = ${vieja}`;
    chk("el dryRun NO vació nada", sigue?.cuerpo !== null, "vació igual");

    const r = await purga();
    chk("la corrida real responde 200", r.status === 200, JSON.stringify(r).slice(0, 120));
    chk("purgó exactamente UNA", r.data?.purgadas === 1, JSON.stringify(r.data?.purgadas));

    const [v] = await sql`SELECT asunto, cuerpo, purgado_en FROM mail_outbox WHERE id = ${vieja}`;
    chk("la de 91 días quedó sin asunto", v?.asunto === null, JSON.stringify(v?.asunto));
    chk("y sin cuerpo", v?.cuerpo === null, JSON.stringify(v?.cuerpo));
    chk("y con purgado_en", v?.purgado_en !== null, JSON.stringify(v?.purgado_en));

    const [b] = await sql`SELECT cuerpo FROM mail_outbox WHERE id = ${borde}`;
    chk("LA DE 89 DÍAS NO SE TOCÓ (el borde)", b?.cuerpo !== null, "se purgó antes de tiempo");
    const [n] = await sql`SELECT cuerpo FROM mail_outbox WHERE id = ${nueva}`;
    chk("ni la de 1 día", n?.cuerpo !== null, "se purgó");
  }

  console.log("\n=== 3. EL REGISTRO SOBREVIVE, QUE ES POR QUÉ NO ES UN DELETE ===");
  {
    const [f] = await sql`
      SELECT tipo, para, estado, creado_en FROM mail_outbox
      WHERE purgado_en IS NOT NULL AND tipo = 'zz-prueba' LIMIT 1`;
    chk("la fila purgada SIGUE EXISTIENDO", Boolean(f), "se borró la fila entera");
    chk("conserva el tipo", f?.tipo === "zz-prueba", f?.tipo);
    chk("conserva el destinatario", String(f?.para ?? "").includes("@test.hotu.local"), f?.para);
    chk("conserva el estado", f?.estado === "registrado", f?.estado);
    chk("y conserva CUÁNDO se mandó", Boolean(f?.creado_en), "sin fecha no prueba nada");
  }

  console.log("\n=== 4. IDEMPOTENTE: LA SEGUNDA PURGA CUENTA CERO ===");
  {
    const segunda = await purga();
    chk("la segunda corrida -> 200", segunda.status === 200, JSON.stringify(segunda).slice(0, 120));
    /**
     * CERO, no uno. Si el WHERE no mirara purgado_en, volvería a "purgar" la misma fila ya
     * vacía en cada corrida y el conteo mentiría para siempre.
     */
    chk("PURGÓ CERO", segunda.data?.purgadas === 0, JSON.stringify(segunda.data?.purgadas));
    const [c] = await sql`SELECT COUNT(*)::int n FROM mail_outbox WHERE purgado_en IS NOT NULL AND tipo = 'zz-prueba'`;
    chk("y sigue habiendo una sola purgada", c.n === 1, String(c.n));
  }

  console.log("\n=== 5. EL LECTOR NO SE ROMPE CON UNA FILA PURGADA ===");
  {
    /**
     * getMailOutbox tipaba asunto como string, y la migración lo volvió nullable. Esto
     * comprueba que la lectura que alimenta el smoke sobrevive a una fila purgada en vez de
     * reventar o devolver basura.
     */
    const S = process.env.SMOKE_SECRET;
    if (!S) {
      chk("SMOKE_SECRET en el entorno", false, "sin él no se puede ejercitar el lector");
    } else {
      const r = await fetch(`${BASE}/api/smoke?secret=${S}`);
      const j = await r.json().catch(() => ({}));
      const lectura = (j.resultados ?? []).find((x) => x.lector === "getMailOutbox");
      chk("el smoke ejercita getMailOutbox", Boolean(lectura), "no está en la lista");
      chk("y no se rompe con una fila purgada", lectura?.ok === true, JSON.stringify(lectura));
    }
  }

  console.log("\n=== 6. PERMISOS Y GUARDAS DE LA RUTA ===");
  {
    const sin = await fetch(`${BASE}/api/mantenimiento-mail-outbox`);
    chk("sin secreto -> 401", sin.status === 401, String(sin.status));
    const malo = await fetch(`${BASE}/api/mantenimiento-mail-outbox?secret=zz-no-es`);
    chk("con un secreto equivocado -> 401", malo.status === 401, String(malo.status));
    const S = process.env.SMOKE_SECRET;
    if (S && S !== SECRETO) {
      const conSmoke = await fetch(`${BASE}/api/mantenimiento-mail-outbox?secret=${S}`);
      chk("SMOKE_SECRET NO abre esta ruta (escribe, no lee)", conSmoke.status === 401, String(conSmoke.status));
    }
  }

  await sql`DELETE FROM mail_outbox WHERE tipo = 'zz-prueba'`;
} finally {
  const resumen = await corrida.cerrar();
  console.log(`\nbarrido: ${JSON.stringify(resumen?.borrado ?? {})}`);
}

console.log(`\n=== ${ok} OK, ${mal} MAL ===`);
process.exit(mal === 0 ? 0 : 1);
