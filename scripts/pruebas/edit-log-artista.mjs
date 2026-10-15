/**
 * BATERÍA DE edit_log CON 'artista' Y 'toque'.
 *
 * ============================================================
 * POR QUÉ ESTA BATERÍA Y NO LA VERIFICACIÓN DE LA MIGRACIÓN
 * ============================================================
 *
 * La migración compara la definición RENDERIZADA del CHECK contra la medida, y eso prueba la
 * FORMA. No prueba la CORRECCIÓN: un CHECK puede tener exactamente la forma que uno escribió
 * y aceptar lo que tenía que rechazar. En este repo ya pasó dos veces —los CHECK de motivo y
 * de cancelación de las convocatorias—, y las dos veces lo encontró un INSERT de verdad.
 *
 * Y UN CHECK QUE EVALÚA A NULL PASA. `col = ANY(ARRAY[...])` con col en NULL da NULL, y
 * `NULL OR false` da NULL, que Postgres acepta. Cada rama del OR necesita su propia defensa, y
 * la única forma de saber si la tiene es mandarle la fila.
 *
 * ============================================================
 * LOS DIEZ CASOS, Y EL QUE IMPORTA MÁS
 * ============================================================
 *
 * El espacio duro. El conjunto de blancos del btrim incluye U+00A0 justamente para que un
 * collective_slug hecho sólo de espacios duros no pase. Ese carácter es INVISIBLE en el
 * fuente, así que si alguien "limpia espacios" en esa línea y lo retipea como espacio normal,
 * el CHECK se vuelve más laxo y NADA lo dice. Este es el chequeo que lo diría.
 */

import { neon } from "@neondatabase/serverless";
import { abrirCorrida } from "./seed.mjs";

const sql = neon(process.env.DATABASE_URL);

/** El NBSP con escape y no literal, por lo mismo que en la migración. */
const NBSP = "\u00A0";

const ACTOR = "zz-edit-log@test.hotu.local";
const SLUG = "zz-colectivo-de-prueba";

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
 * Manda la fila y dice si entró. No distingue POR QUÉ falló a propósito: lo que se mide es si
 * la base la acepta, y cualquier otro error se vería en el detalle.
 */
const meter = async (entidad, slug, rol = "dueno") => {
  try {
    const r = await sql(
      `INSERT INTO edit_log
         (actor_email, actor_rol, collective_slug, entidad, entidad_id, accion)
       VALUES ($1, $2, $3, $4, 'zz-1', 'editar') RETURNING id`,
      [ACTOR, rol, slug, entidad]
    );
    return { entro: true, id: r[0].id };
  } catch (e) {
    return { entro: false, error: e.message.split("\n")[0] };
  }
};

const corrida = await abrirCorrida(sql, "bateria de edit_log artista");
try {
  console.log("\n== 0. la migración está aplicada, porque si no todo lo de abajo miente");
  {
    const [c] = await sql`SELECT is_nullable FROM information_schema.columns
      WHERE table_name='edit_log' AND column_name='collective_slug'`;
    chk("collective_slug acepta NULL", c?.is_nullable === "YES", JSON.stringify(c));
    const checks = await sql`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid='edit_log'::regclass AND contype='c'`;
    const entidad = checks.find((x) => x.conname === "edit_log_entidad_check")?.def ?? "";
    chk("el CHECK de entidad nombra 'artista'", entidad.includes("'artista'"), entidad);
    chk("y 'toque'", entidad.includes("'toque'"), entidad);
    const col = checks.find((x) => x.conname === "edit_log_colectivo_check")?.def ?? "";
    chk("el CHECK de colectivo ata las dos mitades", /IS NULL/.test(col) && /IS NOT NULL/.test(col), col);
  }

  console.log("\n== 1. LAS DOS ENTIDADES NUEVAS: sin colectivo, y SOLO sin colectivo");
  {
    const a = await meter("artista", null);
    chk("entidad='artista' con collective_slug NULL ENTRA", a.entro, a.error);
    const b = await meter("artista", SLUG);
    chk("entidad='artista' CON collective_slug se RECHAZA", !b.entro, "entró, el CHECK no ata esa mitad");
    const c = await meter("toque", null);
    chk("entidad='toque' con collective_slug NULL ENTRA", c.entro, c.error);
    const d = await meter("toque", SLUG);
    chk("entidad='toque' CON collective_slug se RECHAZA", !d.entro, "entró");
  }

  console.log("\n== 2. LOS SIETE DE ANTES: siguen exigiendo su colectivo");
  for (const e of ["collective", "event", "news", "set", "track", "genero", "imagen"]) {
    const con = await meter(e, SLUG);
    chk(`entidad='${e}' con slug ENTRA`, con.entro, con.error);
    const sin = await meter(e, null);
    chk(`entidad='${e}' SIN slug se RECHAZA`, !sin.entro, "entró sin decir de qué colectivo");
  }

  console.log("\n== 3. UN SLUG DE BLANCOS NO ES UN SLUG, Y EL ESPACIO DURO ES EL QUE IMPORTA");
  {
    const esp = await meter("event", "   ");
    chk("slug de espacios normales se RECHAZA", !esp.entro, "entró");
    const tab = await meter("event", "\t\t");
    chk("slug de tabs se RECHAZA", !tab.entro, "entró");
    const salto = await meter("event", "\n");
    chk("slug de un salto de línea se RECHAZA", !salto.entro, "entró");
    /**
     * EL CHEQUEO QUE JUSTIFICA LA BATERÍA. Si alguien retipea el conjunto de blancos sin el
     * U+00A0 —que no se ve—, el CHECK queda más laxo y este es el único lugar que lo grita.
     */
    const duro = await meter("event", NBSP + NBSP);
    chk("slug de DOS ESPACIOS DUROS (U+00A0) se RECHAZA", !duro.entro, "entró: el NBSP se cayó del conjunto de blancos");
    const mezcla = await meter("event", " " + NBSP + "\t");
    chk("slug de espacio + duro + tab se RECHAZA", !mezcla.entro, "entró");
    /** Y que un slug con un espacio duro ADENTRO sí entre: lo prohibido es que sea TODO blanco. */
    const adentro = await meter("event", "zz" + NBSP + "colectivo");
    chk("un slug con un espacio duro ADENTRO sí entra", adentro.entro, adentro.error);
  }

  console.log("\n== 4. una entidad que nadie declaró no entra por ningún lado");
  {
    const raro = await meter("artista_inventado", null);
    chk("entidad='artista_inventado' se RECHAZA", !raro.entro, "entró");
    const vacia = await meter("", null);
    chk("entidad vacía se RECHAZA", !vacia.entro, "entró");
  }

  console.log("\n== 5. el rol 'moderador', que es quien va a asignar las ciudades");
  {
    const m = await meter("artista", null, "moderador");
    chk("actor_rol='moderador' con entidad='artista' ENTRA", m.entro, m.error);
    const s = await meter("artista", null, "super_admin");
    chk("actor_rol='super_admin' ENTRA", s.entro, s.error);
    const x = await meter("artista", null, "residente_inventado");
    chk("un rol inventado se RECHAZA", !x.entro, "entró");
  }

  console.log("\n== 6. y lo que quedó escrito es lo que se mandó");
  {
    const filas = await sql`SELECT entidad, collective_slug, actor_rol FROM edit_log
      WHERE actor_email = ${ACTOR} ORDER BY id`;
    const artistas = filas.filter((f) => f.entidad === "artista");
    chk(
      `las ${artistas.length} filas de 'artista' quedaron con collective_slug en NULL`,
      artistas.length > 0 && artistas.every((f) => f.collective_slug === null),
      JSON.stringify(artistas)
    );
    const eventos = filas.filter((f) => f.entidad === "event");
    chk(
      `las ${eventos.length} filas de 'event' quedaron con su slug`,
      eventos.length > 0 && eventos.every((f) => f.collective_slug !== null),
      JSON.stringify(eventos)
    );
  }
} finally {
  /**
   * Se borran por actor_email ADEMÁS del barrido por delta. El delta las agarraría igual
   * —edit_log está en TABLAS_VOLATILES— pero una batería que deja basura si el barrido falla
   * es una batería que ensucia la tabla que el resto de la suite cuenta.
   */
  const borradas = await sql`DELETE FROM edit_log WHERE actor_email = ${ACTOR} RETURNING id`;
  console.log(`\nfilas de prueba borradas: ${borradas.length}`);
  const resumen = await corrida.cerrar();
  console.log(`barrido: ${JSON.stringify(resumen?.borrado ?? {})}`);
}

console.log(`\n=== ${ok} OK, ${mal} MAL ===`);
process.exit(mal === 0 ? 0 : 1);
