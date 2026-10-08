/**
 * UNA SESIÓN FALSEADA, SOLO PARA LAS BATERÍAS.
 *
 * Reemplaza a @/auth cuando el hook de resolución está activo y ZZ_AUTH_EMAIL está puesta. Sin
 * esto no se puede llamar al handler de una ruta autenticada desde node: auth() devuelve null
 * y la ruta contesta 401 antes de ejecutar nada de lo que se quiere probar.
 *
 * ============================================================
 * POR QUÉ ESTO NO ES UN AGUJERO
 * ============================================================
 *
 * No viaja a producción y no puede: vive en scripts/pruebas/, y el único camino que lo carga es
 * scripts/pruebas/hook-rutas.mjs, que a su vez solo se registra desde una batería. Nada en
 * app/, lib/ o components/ lo importa ni lo nombra — y eso es verificable con un grep, no una
 * promesa. El bundler de Next no lo ve nunca porque la resolución de @/auth que Next hace es
 * la suya, no la del hook.
 *
 * ADEMÁS ESTÁ DETRÁS DE UNA VARIABLE. Sin ZZ_AUTH_EMAIL el hook no redirige @/auth, así que
 * una batería que se olvide de ponerla recibe la auth de verdad y un 401 ruidoso, no una
 * sesión vacía que se cuele como anónima.
 *
 * ============================================================
 * LA SESIÓN ES LO ÚNICO QUE SE FALSEA
 * ============================================================
 *
 * El rol NO: isModerator() y las tres puertas de colectivo siguen consultando la base de
 * verdad. Así que una batería que quiera entrar al admin tiene que CREAR la fila en user_roles,
 * y si la regla de permisos cambia, la prueba se rompe como corresponde.
 *
 * Falsear el rol además de la sesión dejaría las pruebas de permisos probando el mock.
 */

export async function auth() {
  const email = process.env.ZZ_AUTH_EMAIL;
  if (!email) return null;
  return { user: { email } };
}

/** next-auth exporta varias cosas; las baterías solo necesitan auth(). */
export const handlers = {};
export const signIn = async () => {
  throw new Error("signIn no existe en la auth falseada de las baterías");
};
export const signOut = async () => {
  throw new Error("signOut no existe en la auth falseada de las baterías");
};
