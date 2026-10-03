/**
 * El tope de fotos de la galería. Dato puro, sin imports.
 *
 * Vive acá y no en lib/epk-galeria-write.ts por la regla del repo: ese archivo llama
 * neon(process.env.DATABASE_URL!) a nivel de módulo, así que importar un VALOR de ahí
 * mete el cliente de la base en el bundle del navegador. Y la sección de galería es un
 * client component que necesita el número en runtime para poder DECIR el tope en vez de
 * solo deshabilitar un botón. Mismo motivo que lib/socials.ts, lib/rider.ts y
 * lib/date-utils.ts.
 *
 * UNA SOLA DEFINICIÓN, importada por los dos lados. Un 12 escrito en la UI y otro 12 en el
 * write path es cómo un día la pantalla deja agregar la foto 13 y la API la rechaza, o
 * peor, al revés.
 *
 * Y EL DE LA UI NO ES UN TOPE: es un cartel. La guarda está en el write path, adentro del
 * INSERT, porque la API sigue estando ahí para cualquiera que no use la pantalla.
 */

export const MAX_FOTOS = 12;
