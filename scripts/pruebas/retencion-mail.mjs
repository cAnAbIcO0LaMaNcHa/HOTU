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


  console.log("\n=== 7. LA PUERTA DEL SCHEDULER: CRON_SECRET, NUNCA MIGRATE_SECRET ===");
  {
    const C = process.env.CRON_SECRET;
    chk("CRON_SECRET está en el entorno de dev", Boolean(C), "sin ella no se puede probar esta puerta");

    const conHeader = (valor) =>
      fetch(`${BASE}/api/mantenimiento-mail-outbox`, {
        headers: valor === null ? {} : { Authorization: valor },
      });

    /** SIN LLAVE. */
    chk("sin ningún header ni secreto -> 401", (await conHeader(null)).status === 401);

    /** LLAVE MALA, en sus tres formas de estar mal. */
    for (const [v, que] of [
      ["Bearer zz-no-es-la-llave", "un Bearer equivocado"],
      [`Bearer ${C}x`, "la llave con un carácter de más"],
      [C ?? "", "la llave SIN el prefijo Bearer"],
      ["Bearer undefined", "el literal 'Bearer undefined'"],
    ]) {
      chk(`${que} -> 401`, (await conHeader(v)).status === 401, que);
    }

    /**
     * Y LA LLAVE DE MIGRACIONES NO ABRE ESTA PUERTA POR HEADER. Son poderes distintos: el
     * scheduler no tiene por qué cargar la llave con la que se borran boletas, y si una
     * abriera la otra la separación no existiría.
     */
    const M = process.env.MIGRATE_SECRET;
    if (M && M !== C) {
      chk("MIGRATE_SECRET como Bearer -> 401", (await conHeader(`Bearer ${M}`)).status === 401);
    }

    /** LLAVE BUENA: purga, y solo lo que pasó el plazo. */
    if (C) {
      await sql`DELETE FROM mail_outbox WHERE tipo = 'zz-prueba'`;
      const vieja = await encolar(95, "cron-vieja");
      const nueva = await encolar(10, "cron-nueva");

      const r = await conHeader(`Bearer ${C}`);
      const d = await r.json().catch(() => ({}));
      chk("con la llave buena -> 200", r.status === 200, String(r.status));
      chk("PURGÓ UNA, la de 95 días", d?.purgadas === 1, JSON.stringify(d?.purgadas));

      const [v] = await sql`SELECT cuerpo, purgado_en FROM mail_outbox WHERE id = ${vieja}`;
      chk("la vieja quedó sin cuerpo", v?.cuerpo === null, JSON.stringify(v?.cuerpo));
      chk("y con purgado_en", v?.purgado_en !== null, JSON.stringify(v?.purgado_en));
      const [n] = await sql`SELECT cuerpo FROM mail_outbox WHERE id = ${nueva}`;
      chk("LA DE 10 DÍAS NO SE TOCÓ", n?.cuerpo !== null, "se purgó antes de tiempo");

      /** Y es idempotente por esta puerta también. */
      const otra = await (await conHeader(`Bearer ${C}`)).json().catch(() => ({}));
      chk("la segunda pasada del cron purga CERO", otra?.purgadas === 0, JSON.stringify(otra?.purgadas));

      /**
       * EL CRON NO PUEDE PEDIR dryRun, y da 400 en vez de ignorarlo: ignorarlo dejaría a
       * alguien creyendo que simula mientras purga, o un cron que no purga nunca.
       */
      const seco = await fetch(`${BASE}/api/mantenimiento-mail-outbox?dryRun=1`, {
        headers: { Authorization: `Bearer ${C}` },
      });
      chk("el cron pidiendo dryRun -> 400", seco.status === 400, String(seco.status));
      const msj = await seco.json().catch(() => ({}));
      chk("y el mensaje explica las dos salidas malas", /simula|purga/i.test(msj?.error ?? ""), msj?.error);

      /** Pero a mano SÍ se puede simular, que es para lo que existe el dryRun. */
      const aMano = await fetch(`${BASE}/api/mantenimiento-mail-outbox?dryRun=1&secret=${M}`);
      chk("a mano con MIGRATE_SECRET el dryRun SÍ anda -> 200", aMano.status === 200, String(aMano.status));

      await sql`DELETE FROM mail_outbox WHERE tipo = 'zz-prueba'`;
    }
  }
  await sql`DELETE FROM mail_outbox WHERE tipo = 'zz-prueba'`;

  console.log("\n=== 8. FALLA CERRADO: SIN CRON_SECRET LA PUERTA NO EXISTE ===");
  {
    /**
     * ESTA ES LA ÚNICA RAMA QUE NO SE PUEDE PROBAR CONTRA EL SERVER, y hay que decir por qué
     * en vez de saltearla: el server lee el entorno al arrancar, así que probar "sin
     * CRON_SECRET" exigiría reiniciarlo sin la variable en medio de la batería. Eso dejaría
     * el server en un estado distinto del que tiene el resto de la suite.
     *
     * Así que se prueba LA DECISIÓN, no el transporte: se evalúa la misma expresión del
     * route handler con la variable ausente. Es un modelo, y por eso la expresión está
     * copiada literal de app/api/mantenimiento-mail-outbox/route.ts — si allá cambia y acá
     * no, esta prueba deja de significar algo, y el grep de abajo lo ataja.
     */
    const abre = (cronSecret, authHeader) =>
      Boolean(cronSecret) && authHeader === `Bearer ${cronSecret}`;

    chk("sin la variable, un Bearer cualquiera NO abre", abre(undefined, "Bearer lo-que-sea") === false);
    chk("sin la variable, 'Bearer undefined' NO abre", abre(undefined, "Bearer undefined") === false);
    chk("con la variable vacía tampoco", abre("", "Bearer ") === false);
    chk("y con la variable puesta y el header correcto SÍ", abre("abc", "Bearer abc") === true);

    /**
     * Y QUE LA EXPRESIÓN DE ARRIBA SIGA SIENDO LA DEL CÓDIGO. Un grep estático, igual que el
     * de un-solo-escritor-de-residente: si el route handler cambiara su forma de decidir,
     * esto falla ruidosamente en vez de seguir probando una copia vieja.
     */
    const fuente = readFileSync("app/api/mantenimiento-mail-outbox/route.ts", "utf8");
    chk(
      "el route handler sigue decidiendo con Boolean(cronSecret) && header === `Bearer ${cronSecret}`",
      /Boolean\(cronSecret\)\s*&&\s*authHeader === `Bearer \$\{cronSecret\}`/.test(fuente),
      "la expresión del código cambió: esta sección está probando una copia vieja"
    );
  }
} finally {
  const resumen = await corrida.cerrar();
  console.log(`\nbarrido: ${JSON.stringify(resumen?.borrado ?? {})}`);
}

console.log(`\n=== ${ok} OK, ${mal} MAL ===`);
process.exit(mal === 0 ? 0 : 1);
