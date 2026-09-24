/**
 * Los tres FK contra user_profiles hacen lo que dicen.
 *
 * Lo que importa probar no es que existan —eso lo verifica la migración—
 * sino que la base NIEGUE lo que el código no debería poder hacer.
 */
import { neon } from "@neondatabase/serverless";
import { abrirCorrida } from "./seed.mjs";
const sql = neon(process.env.DATABASE_URL);
const corrida = await abrirCorrida(sql, "fks-cuenta.mjs");

let ok = 0, mal = 0;
const chk = (n, c, d = "") => { if (c) { ok++; console.log("   OK   " + n); } else { mal++; console.log("   MAL  " + n + " -> " + d); } };

const CUENTA = "zz-fk@test.hotu.local";
async function limpiar() {
  await sql`DELETE FROM tickets WHERE lower(user_email) = ${CUENTA}`;
  await sql`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE lower(user_email) = ${CUENTA})`;
  await sql`DELETE FROM orders WHERE lower(user_email) = ${CUENTA}`;
  await sql`DELETE FROM user_roles WHERE lower(email) = ${CUENTA}`;
  await sql`DELETE FROM user_profiles WHERE lower(email) = ${CUENTA}`;
}
await limpiar();
await sql`INSERT INTO user_profiles (email, display_name, auth_provider) VALUES (${CUENTA},'ZZ FK','credentials')`;

console.log("=== LAS TRES FILAS HUÉRFANAS YA NO SE PUEDEN CREAR ===");
{
  const intentar = async (nombre, fn) => {
    try { await fn(); return "aceptado"; }
    catch (e) { return e.message.includes("violates foreign key") ? "rechazado" : "otro: " + e.message.slice(0, 60); }
  };
  const r1 = await intentar("orders", () =>
    sql`INSERT INTO orders (user_email, kind, status, amount_cop) VALUES ('no-existe@ningun.lado','tickets','pending',1000)`);
  chk("un pedido de una cuenta inexistente -> rechazado", r1 === "rechazado", r1);

  const r2 = await intentar("user_roles", () =>
    sql`INSERT INTO user_roles (email, role, country_code) VALUES ('no-existe@ningun.lado','SUPER_ADMIN','COL')`);
  chk("un ROL de una cuenta inexistente -> rechazado", r2 === "rechazado", r2);

  // Y el caso de las mayúsculas, que es el que un lower() no ve.
  const r3 = await intentar("casing", () =>
    sql`INSERT INTO orders (user_email, kind, status, amount_cop) VALUES ('ZZ-FK@TEST.HOTU.LOCAL','tickets','pending',1000)`);
  chk("el MISMO email en mayúsculas -> rechazado", r3 === "rechazado", r3);
}

console.log("\n=== UNA CUENTA CON PEDIDOS NO SE PUEDE BORRAR ===");
{
  const [o] = await sql`INSERT INTO orders (user_email, kind, status, amount_cop)
                        VALUES (${CUENTA},'tickets','pending',1000) RETURNING id`;
  try {
    await sql`DELETE FROM user_profiles WHERE lower(email) = ${CUENTA}`;
    chk("borrar la cuenta con un pedido -> RECHAZADO", false, "la borró");
  } catch (e) {
    chk("borrar la cuenta con un pedido -> RECHAZADO", e.message.includes("violates foreign key"), e.message.slice(0, 80));
  }
  chk("la cuenta sigue existiendo", (await sql`SELECT count(*)::int n FROM user_profiles WHERE lower(email)=${CUENTA}`)[0].n === 1);
  chk("y el pedido también", (await sql`SELECT count(*)::int n FROM orders WHERE id=${o.id}`)[0].n === 1);

  // Y con el orden correcto —el de la limpieza pre-lanzamiento— sí sale.
  await sql`DELETE FROM order_items WHERE order_id = ${o.id}`;
  await sql`DELETE FROM orders WHERE id = ${o.id}`;
  try {
    await sql`DELETE FROM user_profiles WHERE lower(email) = ${CUENTA}`;
    chk("borrando primero el pedido, la cuenta SÍ sale", true);
  } catch (e) {
    chk("borrando primero el pedido, la cuenta SÍ sale", false, e.message.slice(0, 80));
  }
}

console.log("\n=== EL ROL SE VA CON LA CUENTA (el agujero que cerraba) ===");
{
  await sql`INSERT INTO user_profiles (email, display_name, auth_provider) VALUES (${CUENTA},'ZZ FK','credentials')`;
  await sql`INSERT INTO user_roles (email, role, country_code) VALUES (${CUENTA},'SUPER_ADMIN','COL')`;
  chk("la cuenta tiene el rol", (await sql`SELECT count(*)::int n FROM user_roles WHERE lower(email)=${CUENTA}`)[0].n === 1);

  await sql`DELETE FROM user_profiles WHERE lower(email) = ${CUENTA}`;
  const [r] = await sql`SELECT count(*)::int n FROM user_roles WHERE lower(email) = ${CUENTA}`;
  chk("al borrar la cuenta, EL ROL SE VA CON ELLA", r.n === 0, String(r.n));
  chk("así que re-registrar ese email no hereda nada", r.n === 0);
}

console.log("\n=== RENOMBRAR UNA CUENTA CASCADEA (ON UPDATE) ===");
{
  await sql`INSERT INTO user_profiles (email, display_name, auth_provider) VALUES (${CUENTA},'ZZ FK','credentials')`;
  const [o] = await sql`INSERT INTO orders (user_email, kind, status, amount_cop)
                        VALUES (${CUENTA},'tickets','pending',1000) RETURNING id`;
  const NUEVO = "zz-fk2@test.hotu.local";
  await sql`DELETE FROM user_profiles WHERE email = ${NUEVO}`;
  await sql`UPDATE user_profiles SET email = ${NUEVO} WHERE lower(email) = ${CUENTA}`;
  const [x] = await sql`SELECT user_email FROM orders WHERE id = ${o.id}`;
  chk("el pedido siguió a la cuenta renombrada", x.user_email === NUEVO, String(x.user_email));
  await sql`DELETE FROM order_items WHERE order_id = ${o.id}`;
  await sql`DELETE FROM orders WHERE id = ${o.id}`;
  await sql`DELETE FROM user_profiles WHERE email = ${NUEVO}`;
}

await limpiar();
const fin = await corrida.cerrar();
console.log(`\n=== ${ok} OK, ${mal} MAL ===`);
console.log("borrado por esta corrida:", JSON.stringify(fin.borrado));
console.log("seed:", JSON.stringify(fin.estado));
