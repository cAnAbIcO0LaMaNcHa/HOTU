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

import { tomarCandado } from "./candado.mjs";

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
  /**
   * profile_ownership por LOS DOS slugs, no solo el de colectivo.
   *
   * Decía solo collective_slug —venía de cuando la tabla era
   * collective_ownership y no existían los reclamos de artista— así que
   * las filas con artist_slug sobrevivían para siempre. El barrido por
   * delta tampoco las tocaba: estaban antes de la foto, o sea que para él
   * no las creó esta corrida. Dos baterías después, un chequeo que contaba
   * filas fallaba por acumulación.
   */
  await sql`DELETE FROM profile_ownership WHERE collective_slug LIKE 'zz-%' OR artist_slug LIKE 'zz-%'`;

  /**
   * Y la bandeja de salida, que no se barría en absoluto.
   *
   * Se limpia por DESTINATARIO y por REFERENCIA, que es lo que identifica
   * un aviso de prueba: va a un dominio de prueba, o habla de un perfil
   * zz-. Hoy en dev nada más escribe esta tabla, pero barrer por patrón y
   * no entera es lo que va a seguir andando el día que algo real la use.
   */
  await sql`DELETE FROM mail_outbox
            WHERE para LIKE '%@test.hotu.local' OR para LIKE '%@perfil.hotu.local'
               OR para LIKE 'zz-%' OR referencia LIKE '%zz-%'`;
  await sql`DELETE FROM artist_collectives WHERE collective_slug LIKE 'zz-%' OR artist_slug LIKE 'zz-%'`;
  await sql`DELETE FROM order_items WHERE event_id IN (SELECT id FROM events WHERE title LIKE 'ZZ%' OR title LIKE 'ZB-%' OR title LIKE 'EVT-%')`;
  await sql`DELETE FROM events WHERE title LIKE 'ZZ%' OR title LIKE 'ZB-%' OR title LIKE 'EVT-%' OR title LIKE 'CEN-%' OR title LIKE 'HALL-%' OR title LIKE 'ADM-%' OR title LIKE 'PRUEBA-%'`;
  await sql`DELETE FROM news WHERE title LIKE 'ZZ%' OR title LIKE 'CEN-%' OR title LIKE 'HALL-%' OR title LIKE 'ADM-%' OR title LIKE 'PRUEBA-%'`;
  await sql`DELETE FROM collectives WHERE slug LIKE 'zz-%'`;
  await sql`DELETE FROM artists WHERE slug LIKE 'zz-%'`;

  /**
   * EL COMERCIO DE PRUEBA, ANTES QUE LA CUENTA, Y EN ESTE ORDEN.
   *
   * Desde que orders.user_email y tickets.user_email tienen FK con
   * ON DELETE RESTRICT, el DELETE de abajo TIRA si alguna cuenta zz-
   * llegó a comprar algo. Y no falla en la prueba que compró: falla en
   * la SIGUIENTE, al arrancar, con un foreign_key_violation que no tiene
   * nada que ver con lo que esa batería estaba probando.
   *
   * El orden es el mismo que usa la limpieza pre-lanzamiento, por la
   * misma razón: es el mecanismo, no un atajo. ticket_attributions
   * apunta a tickets con RESTRICT, y tickets apunta a orders y a
   * order_items también con RESTRICT.
   */
  await sql`DELETE FROM ticket_attributions WHERE ticket_id IN (SELECT id FROM tickets WHERE user_email LIKE 'zz-%')`;
  await sql`DELETE FROM tickets WHERE user_email LIKE 'zz-%'`;
  await sql`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_email LIKE 'zz-%')`;
  await sql`DELETE FROM orders WHERE user_email LIKE 'zz-%'`;

  await sql`DELETE FROM user_profiles WHERE email LIKE 'zz-%'`;

  /**
   * El registro de eliminaciones de prueba. Es la ÚNICA tabla que se
   * limpia por su propio email y no por una FK, justamente porque no
   * tiene ninguna: sobrevive a la cuenta a propósito.
   */
  await sql`DELETE FROM account_removals WHERE email LIKE 'zz-%'`;

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

/* ===================================================================
 * BORRAR SOLO LO QUE ESTA CORRIDA CREÓ
 *
 * restaurarSeed() barre por PATRÓN, y eso tiene un costo: borra filas que
 * matchean la convención aunque no sean de esta corrida. Con el candado
 * puesto no puede haber nadie más, pero "no puede haber" es una premisa y
 * esto es una medición.
 *
 * La idea: después del barrido inicial, dev está en un estado conocido.
 * Se saca una FOTO de las PK de todo lo que una batería puede llegar a
 * tocar, y al final se borra la DIFERENCIA. Eso es exactamente "lo que
 * esta corrida creó", sin un solo patrón en el medio: ni zz-, ni
 * @test.hotu.local, ni nada que alguien pueda elegir por casualidad.
 *
 * Son 18 tablas y ~160 filas en dev, así que la foto entera sale en una
 * consulta por tabla y no se nota.
 *
 * OJO CON LA DIVISIÓN DEL TRABAJO: esto borra lo CREADO. Lo MODIFICADO
 * —bans, censuras, propiedad movida— lo sigue arreglando restaurarSeed(),
 * porque una fila cambiada no aparece en ninguna diferencia de claves.
 * Las dos hacen falta, en ese orden.
 * =================================================================== */

/**
 * tabla -> expresión SQL que la identifica. En orden de BORRADO, de
 * adentro hacia afuera: cada una va antes de lo que la referencia, así
 * ningún FK se queja. Si una batería futura crea filas en una tabla que
 * no está acá, el borrado va a fallar RUIDOSAMENTE con un FK, que es la
 * dirección correcta del error.
 */
const TABLAS_VOLATILES = [
  ["ticket_attributions", "id::text"],
  ["tickets", "id::text"],
  ["order_items", "id::text"],
  ["orders", "id::text"],
  ["account_removals", "id::text"],
  ["profile_ownership", "id::text"],
  /**
   * mail_outbox FALTABA, y se notó: las filas se acumulaban entre
   * baterías porque ninguna las borraba, y un chequeo de reclamos que
   * contaba "cuántos avisos de este tipo hay" pasaba sola y fallaba en la
   * suite. Un conteo global sobre una tabla que nadie limpia es una
   * prueba que depende del orden en que se corran las demás.
   */
  ["mail_outbox", "id::text"],
  ["artist_collectives", "id::text"],
  ["artist_gigs", "id::text"],
  ["artist_likes", "artist_slug || '|' || user_email"],
  ["collective_likes", "collective_slug || '|' || user_email"],
  ["dj_sets", "slug"],
  ["tracks", "slug"],
  ["news", "id::text"],
  ["events", "id::text"],
  ["user_roles", "id::text"],
  ["artists", "slug"],
  ["collectives", "slug"],
  ["user_profiles", "email"],
];

/** La línea de base: qué había justo antes de que la batería empiece. */
export async function fotoDeDev(sql) {
  const foto = {};
  for (const [tabla, clave] of TABLAS_VOLATILES) {
    const filas = await sql(`SELECT ${clave} AS k FROM ${tabla}`);
    foto[tabla] = filas.map((f) => String(f.k));
  }
  return foto;
}

/**
 * Borra lo que no estaba en la foto. Devuelve el conteo por tabla, para
 * que la batería lo pueda imprimir: un borrado que no dice cuántas filas
 * se llevó no está auditado.
 *
 * Con la foto vacía borra todo lo de esa tabla, y está bien: significa
 * que antes no había nada, así que todo lo que hay es nuevo.
 */
export async function limpiarLoCreado(sql, foto) {
  const borrado = {};
  for (const [tabla, clave] of TABLAS_VOLATILES) {
    const previas = foto?.[tabla] ?? [];
    const filas = await sql(
      `DELETE FROM ${tabla} WHERE NOT (${clave} = ANY($1::text[])) RETURNING 1 AS x`,
      [previas]
    );
    if (filas.length > 0) borrado[tabla] = filas.length;
  }
  return borrado;
}

/* ===================================================================
 * EL PROTOCOLO DE UNA CORRIDA, EN DOS LLAMADAS
 *
 * Toda batería abre con abrirCorrida() y cierra con cerrar(). Existe para
 * que el orden no se pueda equivocar: son cinco pasos al abrir y al
 * cerrar, y cada batería que los escribiera a mano sería una oportunidad
 * de olvidarse del candado o de sacar la foto antes del barrido.
 * =================================================================== */

/**
 * Toma dev en exclusiva, la deja limpia, y se acuerda de cómo estaba.
 *
 * `quien` sale en el mensaje de error de la próxima que intente entrar,
 * así que tiene que decir algo útil: el nombre del archivo.
 */
export async function abrirCorrida(sql, quien) {
  const candado = await tomarCandado(sql, quien);
  // El barrido por patrón va ACÁ y solo acá: con el candado puesto, lo
  // único que puede haber de más es basura de una corrida que se cayó.
  await restaurarSeed(sql);
  // Y la foto se saca DESPUÉS del barrido, si no la línea de base
  // incluiría esa basura y nunca se borraría.
  const foto = await fotoDeDev(sql);

  return {
    /** Vuelve dev a como estaba y suelta el candado. */
    async cerrar() {
      const borrado = await limpiarLoCreado(sql, foto); // lo CREADO
      await restaurarSeed(sql); // lo MODIFICADO
      const estado = await estadoSeed(sql);
      await candado.liberar();
      return { borrado, estado };
    },
  };
}

/** Lo que una batería imprime al terminar, para que se vea de una. */
export async function estadoSeed(sql) {
  const [r] = await sql`
    SELECT
      (SELECT count(*)::int FROM collectives WHERE slug LIKE 'zz-%') basura_colectivos,
      (SELECT count(*)::int FROM artists WHERE slug LIKE 'zz-%') basura_artistas,
      (SELECT count(*)::int FROM user_profiles WHERE email LIKE 'zz-%') basura_cuentas,
      (SELECT count(*)::int FROM profile_ownership) ownership,
      (SELECT count(*)::int FROM user_profiles WHERE banned_at IS NOT NULL) baneadas,
      (SELECT count(*)::int FROM user_roles WHERE email LIKE '%@test.hotu.local') roles_prestados,
      (SELECT owner_email FROM artists WHERE slug = 'test-camila') camila,
      (SELECT owner_email FROM collectives WHERE slug = 'reisen') reisen
  `;
  return r;
}
