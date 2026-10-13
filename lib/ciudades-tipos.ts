/**
 * LO PURO DE LAS CIUDADES: el tipo y cómo se muestra un nombre.
 *
 * Vive aparte de lib/ciudades.ts porque ESTO lo importa el selector, que es un client
 * component, y lib/ciudades.ts abre una conexión a Neon. La regla del repo es que un client
 * component nunca importa lib/db.ts, y esta es la misma razón con otro archivo: un `import`
 * de algo que toca la base arrastra el driver al bundle del navegador.
 *
 * Un `import type` se borra al compilar y alcanzaría para el tipo. No alcanza para
 * nombreMostrable(), que es código y corre en las dos puntas — y tenerlo en un solo lugar es
 * lo que evita que el selector muestre una cosa y la lista otra.
 */

export type Ciudad = {
  /** geonames_id. Es lo que se guarda en city_id. */
  id: number;
  /** El nombre de GeoNames, que es lo que alimenta cities.clave. */
  nombre: string;
  /** El nombre en español, cuando GeoNames lo trae. 12,8% de las filas. */
  nombreEs: string | null;
  /** alpha-3, igual que country_code en las tablas de contenido. */
  pais: string;
  /** El código de la subdivisión de GeoNames. Sirve para desempatar a la vista. */
  admin1: string | null;
  poblacion: number;
};

/**
 * CÓMO SE LEE UNA CIUDAD EN PANTALLA, y por qué los dos nombres y no uno.
 *
 * El sitio está en español, así que "Londres" es lo que hay que mostrar. Pero el que lo tipeó
 * capaz escribió "London", y una lista que sólo dijera "Londres" lo dejaría dudando de si
 * eligió bien. Así que cuando los dos nombres difieren se muestran los dos.
 *
 * Cuando son iguales —o cuando no hay nombre en español, que es el 87,2% de las filas— se
 * muestra uno solo. "Bogotá (Bogotá)" no informa nada.
 */
export function nombreMostrable(c: Ciudad): string {
  if (!c.nombreEs || c.nombreEs === c.nombre) return c.nombre;
  return `${c.nombreEs} (${c.nombre})`;
}

/**
 * EL TEXTO QUE SE GUARDA EN LA COLUMNA VIEJA ES cities.nombre, NO EL NOMBRE EN ESPAÑOL.
 *
 * events.city y artists.city son NOT NULL y sin default, así que el formulario no puede
 * simplemente dejar de escribirlas: un INSERT sin ellas falla. Lo que cambia en el paso 3 es
 * que NADIE LAS TIPEA — salen de la ciudad elegida — y en el paso 4 se borran.
 *
 * Y sale `nombre` y no `nombreEs` por una razón concreta y medible: el backfill cuenta como
 * "incoherente" toda fila cuyo city_id no coincida con la clave de su propio texto, y la clave
 * se deriva de `nombre`. Guardar "Londres" junto al id de London haría que ese contador
 * reportara una fila perfectamente correcta. Es un contador informativo, así que no rompería
 * nada — rompería la señal, que es peor, porque es la que avisa de los casos de verdad.
 *
 * Para Colombia las dos opciones dan lo mismo: 'Bogotá', 'Medellín' y 'Cali' son idénticas en
 * las dos columnas, que es exactamente lo que hay hoy en main.
 */
export function textoLegadoDe(c: Ciudad): string {
  return c.nombre;
}
