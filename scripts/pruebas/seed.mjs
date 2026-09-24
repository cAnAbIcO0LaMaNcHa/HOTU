/**
 * EL SEED DE DEV, EN UN SOLO LUGAR, Y RESTAURABLE.
 *
 * ============================================================
 * POR QUÉ EXISTE
 * ============================================================
 *
 * Tres veces ya una batería dejó los fixtures de dev desalineados, y cada
 * vez la siguiente prueba falló por un motivo que no tenía nada que ver
 * con lo que estaba probando:
 *
 *   1. reasignarDueno mueve TODO lo del dueño, así que un traspaso de
 *      prueba se llevó test-camila de artista@ a usuario@.
 *   2. banearCuenta pone owner_email en NULL en los colectivos de la
 *      cuenta, y levantar el ban NO los devuelve —eso es a propósito—,
 *      así que probar un ban le quitó reisen y bodega-prueba a duena@.
 *   3. Y una corrida que se cae a mitad deja lo que había montado.
 *
 * Las tres veces el producto hizo exactamente lo que tenía que hacer. El
 * problema era que las pruebas tratan los fixtures como si fueran
 * inmutables cuando lo que prueban es justamente cómo se mutan.
 *
 * Así que: toda batería ARRANCA llamando a restaurarSeed(), no termina
 * verificándolo. Verificar al final avisa después del daño.
 *
 * Las constantes salen de /api/seed-test. Si ese archivo cambia, este
 * también.
 */

/** artists.slug -> owner_email, según ARTISTS de /api/seed-test. */
export const ARTISTAS_SEED = [
  ["test-camila", "artista@test.hotu.local"],
  ["test-aplicante", "aplicante@test.hotu.local"],
  ["test-duena", "duena@test.hotu.local"],
  // test-pedro y test-luna nacieron sin dueño y setup-artist-owners les
  // creó una cuenta fantasma. No se tocan: ese ES su estado correcto.
];

/** collectives.slug -> owner_email. */
export const COLECTIVOS_SEED = [
  ["reisen", "duena@test.hotu.local"],
  ["bodega-prueba", "duena@test.hotu.local"],
  ["otu", "colectivo@test.hotu.local"],
];

/**
 * Deja dev como el seed lo dejó, y borra todo lo que las baterías montan.
 *
 * El prefijo zz- es la convención: cualquier fila que una prueba cree
 * lleva ese prefijo en su slug o su email, así que esto se las lleva
 * todas sin tener que acordarse de cada una.
 */
export async function restaurarSeed(sql) {
  // Primero lo que las pruebas crean, para que los UPDATE de abajo no
  // choquen con fixtures a medio armar.
  await sql`DELETE FROM collective_ownership WHERE collective_slug LIKE 'zz-%'`;
  await sql`DELETE FROM artist_collectives WHERE collective_slug LIKE 'zz-%' OR artist_slug LIKE 'zz-%'`;
  await sql`DELETE FROM order_items WHERE event_id IN (SELECT id FROM events WHERE title LIKE 'ZZ%' OR title LIKE 'ZB-%' OR title LIKE 'EVT-%')`;
  await sql`DELETE FROM events WHERE title LIKE 'ZZ%' OR title LIKE 'ZB-%' OR title LIKE 'EVT-%' OR title LIKE 'CEN-%' OR title LIKE 'HALL-%' OR title LIKE 'ADM-%' OR title LIKE 'PRUEBA-%'`;
  await sql`DELETE FROM news WHERE title LIKE 'ZZ%' OR title LIKE 'CEN-%' OR title LIKE 'HALL-%' OR title LIKE 'ADM-%' OR title LIKE 'PRUEBA-%'`;
  await sql`DELETE FROM collectives WHERE slug LIKE 'zz-%'`;
  await sql`DELETE FROM artists WHERE slug LIKE 'zz-%'`;
  await sql`DELETE FROM user_profiles WHERE email LIKE 'zz-%'`;

  // Ningún ban, ninguna censura, ningún rol prestado.
  await sql`UPDATE user_profiles SET banned_at = NULL, banned_by = NULL, ban_reason = NULL WHERE banned_at IS NOT NULL`;
  for (const t of ["artists", "collectives", "events", "news", "dj_sets", "tracks"]) {
    await sql(
      `UPDATE ${t} SET censored_at = NULL, censored_by = NULL, censor_reason = NULL WHERE censored_at IS NOT NULL`
    );
  }
  await sql`DELETE FROM user_roles WHERE email LIKE '%@test.hotu.local'`;

  // Y la propiedad, que es lo que más se mueve.
  for (const [slug, owner] of ARTISTAS_SEED) {
    await sql`UPDATE artists SET owner_email = ${owner} WHERE slug = ${slug}`;
  }
  for (const [slug, owner] of COLECTIVOS_SEED) {
    await sql`UPDATE collectives SET owner_email = ${owner} WHERE slug = ${slug}`;
  }
  await sql`UPDATE artist_collectives SET can_edit = false WHERE can_edit`;
}

/** Lo que una batería imprime al terminar, para que se vea de una. */
export async function estadoSeed(sql) {
  const [r] = await sql`
    SELECT
      (SELECT count(*)::int FROM collectives WHERE slug LIKE 'zz-%') basura_colectivos,
      (SELECT count(*)::int FROM artists WHERE slug LIKE 'zz-%') basura_artistas,
      (SELECT count(*)::int FROM user_profiles WHERE email LIKE 'zz-%') basura_cuentas,
      (SELECT count(*)::int FROM collective_ownership) ownership,
      (SELECT count(*)::int FROM user_profiles WHERE banned_at IS NOT NULL) baneadas,
      (SELECT count(*)::int FROM user_roles WHERE email LIKE '%@test.hotu.local') roles_prestados,
      (SELECT owner_email FROM artists WHERE slug = 'test-camila') camila,
      (SELECT owner_email FROM collectives WHERE slug = 'reisen') reisen
  `;
  return r;
}
