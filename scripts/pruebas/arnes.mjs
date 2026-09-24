/**
 * EL ARNÉS SE PRUEBA A SÍ MISMO.
 *
 * candado.mjs y el barrido por delta de seed.mjs pasaron a ser carga
 * estructural: de ellos depende que las otras cinco baterías no se pisen
 * y que ninguna borre filas ajenas. Un arnés sin probar es peor que no
 * tenerlo, porque las demás pruebas empiezan a confiar en él.
 *
 * Y hay una razón concreta: la primera corrida de las baterías con el
 * arnés puesto reportó `borrado por esta corrida: {}`. Eso es la respuesta
 * BUENA —cada batería limpia lo suyo a mano— pero deja el mecanismo del
 * delta sin ejercitar. Un cero puede significar "funcionó y no había
 * nada" o "no hace nada". Acá se distingue.
 *
 * NO usa abrirCorrida(): probaría el candado tomándolo, que es justo lo
 * que tiene que poder examinar desde afuera. Maneja sus propias filas y
 * las limpia.
 */
import { neon } from "@neondatabase/serverless";
import { tomarCandado, verCandado } from "./candado.mjs";
import { fotoDeDev, limpiarLoCreado } from "./seed.mjs";

const sql = neon(process.env.DATABASE_URL);

let ok = 0, mal = 0;
const chk = (n, c, d = "") => {
  if (c) { ok++; console.log("   OK   " + n); }
  else { mal++; console.log("   MAL  " + n + (d ? " -> " + d : "")); }
};

const AJENA = "zz-arnes-ajena@test.hotu.local";   // existe ANTES de la foto
const NUEVA = "zz-arnes-nueva@test.hotu.local";   // se crea DESPUÉS
const ART = "zz-arnes-dj";

async function limpiarTodo() {
  await sql`DELETE FROM ticket_attributions WHERE ticket_id IN (SELECT id FROM tickets WHERE user_email LIKE 'zz-arnes%')`;
  await sql`DELETE FROM tickets WHERE user_email LIKE 'zz-arnes%'`;
  await sql`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_email LIKE 'zz-arnes%')`;
  await sql`DELETE FROM orders WHERE user_email LIKE 'zz-arnes%'`;
  await sql`DELETE FROM dj_sets WHERE artist_slug = ${ART}`;
  await sql`DELETE FROM artists WHERE slug = ${ART}`;
  await sql`DELETE FROM user_roles WHERE email LIKE 'zz-arnes%'`;
  await sql`DELETE FROM user_profiles WHERE email LIKE 'zz-arnes%'`;
}

await limpiarTodo();
await sql`DELETE FROM zz_test_lock WHERE id = 1`;

console.log("=== EL CANDADO ===");
{
  chk("arranca libre", (await verCandado(sql)) === null);

  const c1 = await tomarCandado(sql, "arnes-primera");
  const tomado = await verCandado(sql);
  chk("se puede tomar", tomado?.quien === "arnes-primera", JSON.stringify(tomado));
  chk("y anota el pid", tomado?.pid === process.pid, String(tomado?.pid));

  let rebotó = false;
  let mensaje = "";
  try {
    await tomarCandado(sql, "arnes-segunda");
  } catch (e) {
    rebotó = true;
    mensaje = e instanceof Error ? e.message : String(e);
  }
  chk("UNA SEGUNDA NO PASA", rebotó, "pasó");
  chk("y el mensaje NOMBRA a quien lo tiene", mensaje.includes("arnes-primera"), mensaje.slice(0, 80));
  chk("y dice cómo destrabarlo", mensaje.includes("candado.mjs liberar"), mensaje.slice(0, 80));
  chk("el dueño no cambió", (await verCandado(sql))?.quien === "arnes-primera");

  await c1.liberar();
  chk("al liberar queda libre", (await verCandado(sql)) === null);

  const c2 = await tomarCandado(sql, "arnes-tercera");
  chk("y se puede volver a tomar", (await verCandado(sql))?.quien === "arnes-tercera");
  await c2.liberar();
}

console.log("\n=== UN CANDADO ABANDONADO SE ROBA, UNO VIVO NO ===");
{
  // Uno de hace una hora: el proceso que lo tomó ya no está.
  await sql`INSERT INTO zz_test_lock (id, quien, pid, host, tomado_en)
            VALUES (1, 'arnes-colgada', 99999, 'otro-host', now() - interval '60 minutes')`;
  const c = await tomarCandado(sql, "arnes-ladrona");
  chk("se roba el de hace 60 minutos", (await verCandado(sql))?.quien === "arnes-ladrona");
  await c.liberar();

  // Uno de hace 5: todavía puede estar trabajando.
  await sql`INSERT INTO zz_test_lock (id, quien, pid, host, tomado_en)
            VALUES (1, 'arnes-viva', 99999, 'otro-host', now() - interval '5 minutes')`;
  let rebotó = false;
  try { await tomarCandado(sql, "arnes-impaciente"); } catch { rebotó = true; }
  chk("NO se roba el de hace 5 minutos", rebotó, "lo robó");
  chk("y sigue siendo del primero", (await verCandado(sql))?.quien === "arnes-viva");
  await sql`DELETE FROM zz_test_lock WHERE id = 1`;
}

console.log("\n=== LIBERAR NO PUEDE SOLTAR EL CANDADO DE OTRO ===");
{
  const c = await tomarCandado(sql, "arnes-mia");
  // Se simula que la fila es de otro proceso, sin tocar el objeto que
  // devolvió tomarCandado: el liberar() de abajo sigue usando NUESTRO pid.
  await sql`UPDATE zz_test_lock SET pid = 99999, quien = 'arnes-de-otro' WHERE id = 1`;
  await c.liberar();
  const q = await verCandado(sql);
  chk("el candado ajeno SOBREVIVE a nuestro liberar", q?.quien === "arnes-de-otro", JSON.stringify(q));
  await sql`DELETE FROM zz_test_lock WHERE id = 1`;
}

console.log("\n=== EL BARRIDO POR DELTA BORRA LO NUEVO Y SOLO LO NUEVO ===");
/**
 * Este bloque SÍ toma el candado, y los de arriba no.
 *
 * Los del candado tienen que poder mirarlo desde afuera; este borra por
 * diferencia, así que cualquier fila que el dev server escriba en el
 * medio —alguien navegando, un login— caería en la diferencia y se iría.
 * Es el uso normal del candado, demostrado acá de paso.
 */
const candadoDelta = await tomarCandado(sql, "arnes.mjs (delta)");
{
  // Una fila que ya existía antes de la foto: hace de "trabajo ajeno".
  await sql`INSERT INTO user_profiles (email, display_name, auth_provider)
            VALUES (${AJENA},'ZZ Arnes Ajena','credentials')`;

  const foto = await fotoDeDev(sql);

  // Y ahora, lo que "esta corrida" crea.
  await sql`INSERT INTO user_profiles (email, display_name, auth_provider)
            VALUES (${NUEVA},'ZZ Arnes Nueva','credentials')`;
  await sql`INSERT INTO artists (slug, name, genre, city, bio, joined_at, district, owner_email)
            VALUES (${ART},'ZZ Arnes DJ','techno','Bogota','fixture','2026-01-01','06',${NUEVA})`;
  await sql`INSERT INTO user_roles (email, role, country_code) VALUES (${NUEVA},'ORGANIZER','COL')`;
  const [o] = await sql`INSERT INTO orders (user_email, kind, status, amount_cop)
                        VALUES (${NUEVA},'tickets','pending',1234) RETURNING id`;

  const cuentasAntes = (await sql`SELECT count(*)::int n FROM user_profiles`)[0].n;

  const borrado = await limpiarLoCreado(sql, foto);
  console.log("   (borró: " + JSON.stringify(borrado) + ")");

  chk("REPORTA que borró la cuenta nueva", (borrado.user_profiles ?? 0) === 1, JSON.stringify(borrado));
  chk("y el artista nuevo", (borrado.artists ?? 0) === 1, JSON.stringify(borrado));
  chk("y el rol nuevo", (borrado.user_roles ?? 0) === 1, JSON.stringify(borrado));
  chk("y el pedido nuevo", (borrado.orders ?? 0) === 1, JSON.stringify(borrado));

  chk("la cuenta NUEVA no está",
    (await sql`SELECT count(*)::int n FROM user_profiles WHERE email=${NUEVA}`)[0].n === 0);
  chk("el artista nuevo no está",
    (await sql`SELECT count(*)::int n FROM artists WHERE slug=${ART}`)[0].n === 0);
  chk("el pedido nuevo no está",
    (await sql`SELECT count(*)::int n FROM orders WHERE id=${o.id}`)[0].n === 0);

  /**
   * LA PROPIEDAD QUE SE PEDÍA, Y LA RAZÓN DE TODO ESTO.
   *
   * AJENA empieza con zz-, así que el barrido por patrón se la habría
   * llevado. Existía antes de la foto, así que el barrido por delta no.
   * Esa diferencia es exactamente lo que le pasó al agente que revisaba a
   * mano mientras las baterías corrían.
   */
  chk("LA FILA AJENA, QUE YA EXISTÍA, SOBREVIVE —y su email matchea zz-",
    (await sql`SELECT count(*)::int n FROM user_profiles WHERE email=${AJENA}`)[0].n === 1,
    "la borró, y es exactamente lo que no tiene que pasar");

  chk("los fixtures del seed siguen enteros",
    (await sql`SELECT count(*)::int n FROM artists WHERE slug='test-camila'`)[0].n === 1);
  chk("el conteo cuadra", (await sql`SELECT count(*)::int n FROM user_profiles`)[0].n === cuentasAntes - 1);

  // Segunda pasada: no queda nada nuevo, así que no borra nada.
  const otra = await limpiarLoCreado(sql, foto);
  chk("una segunda pasada no toca nada", Object.keys(otra).length === 0, JSON.stringify(otra));
}
await candadoDelta.liberar();

await limpiarTodo();
await sql`DELETE FROM zz_test_lock WHERE id = 1`;
console.log(`\n=== ${ok} OK, ${mal} MAL ===`);
console.log("candado al salir:", JSON.stringify(await verCandado(sql)));
process.exit(mal === 0 ? 0 : 1);
