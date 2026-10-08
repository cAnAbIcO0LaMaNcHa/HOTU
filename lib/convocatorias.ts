/**
 * LO QUE SE DERIVA DE UNA CONVOCATORIA, EN UN SOLO LUGAR.
 *
 * Node-only por el import de db; las dos constantes de SQL son texto y no tocan la base, pero
 * este archivo no se importa desde un client component.
 *
 * ============================================================
 * UNA CONVOCATORIA ABIERTA SE DERIVA, NO SE ESCRIBE
 * ============================================================
 *
 * Está abierta cuando se cumplen las TRES, y la condición vive acá una sola vez porque la usan
 * el lector del dueño, el lector del DJ y el write path:
 *
 *   cerrada_en IS NULL          — nadie la cerró a mano
 *   cierra_en es NULL o futuro  — no se le pasó la fecha de cierre
 *   el evento no pasó           — la fiesta todavía no fue
 *
 * DERIVARLA ES LO QUE LA HACE INMEDIATA. Si "cerrada" dependiera de que un cron escribiera
 * cerrada_en, entre que pasa cierra_en y que el cron corre habría una ventana —hasta 24 horas
 * con un cron diario— en la que la convocatoria seguiría aceptando postulaciones después de
 * su propio cierre. El cron existe igual, pero para BARRER el registro, no para decidir el
 * permiso.
 *
 * ============================================================
 * EL DÍA DE HOY SE PREGUNTA EN BOGOTÁ, NUNCA current_date
 * ============================================================
 *
 * MEDIDO contra dev, y por eso está escrito: a las 03:08 UTC del 8 de octubre, current_date en
 * la sesión de Neon daba 2026-10-08 mientras en Bogotá todavía era el 7. El server corre en
 * UTC. Usar current_date cerraría la convocatoria de una fiesta de esa noche justo mientras
 * está pasando, y por cinco horas al día.
 *
 * Es la misma familia que las cinco horas de end_at y que el toISOString de toISODate: el
 * error entra al cruzar entre "fecha de calendario" e "instante" sin decidir la zona.
 *
 * Se usa el NOMBRE de la zona y no el offset fijo de lib/date-utils, y la diferencia es dónde
 * corre: en Postgres el nombre se resuelve contra la tzdata del servidor, que es exactamente
 * lo que hace falta. La constante OFFSET_BOGOTA existe porque el navegador no da ninguna
 * garantía de tzdata. Colombia no tiene horario de verano desde 1993, así que las dos
 * coinciden hoy — pero el nombre es el que sigue siendo correcto si eso cambiara.
 */

/** El día de hoy en Bogotá, como expresión SQL. Una sola copia. */
export const HOY_EN_BOGOTA = "(now() AT TIME ZONE 'America/Bogota')::date";

/**
 * La condición de "abierta", como expresión SQL, asumiendo `ec` para event_calls y `e` para
 * events en el FROM. Una sola copia, por la misma razón que rolSobreColectivo es un primitivo:
 * derivarla dos veces es cómo las dos se separan.
 */
export const CONVOCATORIA_ABIERTA =
  `ec.cerrada_en IS NULL ` +
  `AND (ec.cierra_en IS NULL OR ec.cierra_en > now()) ` +
  `AND e.event_date >= ${HOY_EN_BOGOTA}`;

/**
 * ============================================================
 * EL NOMBRE NORMALIZADO, Y LA DUPLICACIÓN QUE NO PUDE EVITAR
 * ============================================================
 *
 * Aceptar una postulación tiene que REEMPLAZAR la fila sin resolver del lineup que lleva el
 * mismo nombre, no agregar otra al lado — porque event_lineup_event_artist_idx es PARCIAL
 * sobre artist_slug IS NOT NULL y no ve las filas sin resolver. Está medido: 7 de las 9 filas
 * de dev están así, o sea que el caso sin resolver es la mayoría.
 *
 * Y tiene que pasar en UNA sentencia, así que la comparación de nombres tiene que poder
 * hacerse del lado de Postgres. Eso obliga a una SEGUNDA implementación de
 * normalizarNombre(), que ya existe en JS en lib/lineup-import.ts.
 *
 * DOS NORMALIZADORES QUE PUEDEN DISCREPAR ES EXACTAMENTE EL TIPO DE COSA QUE FALLA CALLADA: si
 * discrepan, el UPDATE no encuentra la fila, el INSERT entra al lado, y el lineup muestra al
 * DJ dos veces sin ningún error.
 *
 * LO QUE LO HARÍA INNECESARIO es la extensión `unaccent`, que está DISPONIBLE en Neon y NO
 * instalada —medido—. Instalarla es un cambio de esquema: va con su migración, corrida en dev
 * y después en main, y no entra en esta pieza.
 *
 * Mientras tanto la duplicación se vuelve un invariante MEDIDO en vez de una esperanza: la
 * batería corre los dos normalizadores sobre cada raw_name de event_lineup, cada nombre de
 * artista de dev, y una lista de casos adversarios —acentos, mayúsculas, espacios dobles,
 * tabs, espacios duros, marcas combinantes ya separadas— y exige que coincidan. El día que se
 * separen, falla ruidosamente.
 *
 * El `translate` cubre las vocales acentuadas, la diéresis, la eñe y la cedilla, que es lo que
 * aparece en nombres de DJ en español y portugués. NO cubre todo Unicode, y por eso la
 * comparación medida es parte de la pieza y no un extra.
 */
const ACENTOS = "áéíóúÁÉÍÓÚàèìòùÀÈÌÒÙâêîôûÂÊÎÔÛäëïöüÄËÏÖÜãõÃÕñÑçÇ";
const SIN_ACENTOS = "aeiouAEIOUaeiouAEIOUaeiouAEIOUaeiouAEIOUaoAOnNcC";

/**
 * Normaliza una columna de texto del lado de Postgres. `col` es el nombre de la columna, no
 * un valor: esto arma SQL, así que nunca se le pasa algo que venga del usuario.
 *
 * El orden es el mismo que el de normalizarNombre en JS, y el orden importa: primero se
 * quitan los acentos, después se baja a minúscula, después se colapsan los blancos, y al
 * final se recorta. Colapsar antes de recortar deja un solo espacio en los bordes, que el
 * btrim se lleva.
 *
 * El conjunto de blancos incluye el espacio duro U+00A0, escrito como escape y no como
 * carácter literal — un invisible en el fuente es una bomba de tiempo.
 */
export function normalizarEnSql(col: string): string {
  /**
   * EL CONJUNTO DE BLANCOS SE ARMA CON chr(160) Y [[:space:]], SIN UN SOLO ESCAPE, y las dos
   * decisiones son por lo mismo.
   *
   * Un `'\\u00A0'` no habría funcionado: btrim toma un conjunto de caracteres LITERAL, no una
   * regex, así que ahí una secuencia de escape son seis caracteres que se recortan uno por
   * uno. Y en el patrón de regexp_replace el escape que Postgres entiende es \\uwxyz, que no
   * es el mismo que el de JS — dos sintaxis parecidas para el mismo carácter invisible es
   * exactamente cómo esto se escribe mal sin que se note.
   *
   * chr(160) no tiene ninguna de las dos ambigüedades, no es invisible en el fuente, y no hay
   * herramienta que lo pueda "normalizar" sin que se vea.
   *
   * El btrim final recorta solo espacios comunes, y alcanza: cuando llega ahí, el
   * regexp_replace ya convirtió toda corrida de blancos —incluido el espacio duro— en un
   * único espacio.
   */
  const blancos = `'[[:space:]' || chr(160) || ']+'`;
  /**
   * Y PRIMERO SE BORRAN LAS MARCAS COMBINANTES, que es el caso que la medición encontró.
   *
   * normalizarNombre en JS hace NFD y después borra el bloque U+0300–U+036F, así que le da
   * igual recibir "ë" precompuesta (U+00EB) o descompuesta (e + U+0308): las dos dan "e".
   * translate NO: solo conoce los caracteres de su lista, así que la descompuesta le pasaba
   * entera y los dos normalizadores devolvían cosas distintas que SE VEN IGUAL en pantalla.
   *
   * Y no es un borde de laboratorio: macOS y varios IME producen NFD, así que un nombre
   * tipeado en una Mac y pegado en el lineup llega descompuesto. El síntoma habría sido un DJ
   * duplicado en el lineup, sin un error en ningún lado.
   *
   * translate con un `to` más corto que el `from` BORRA esos caracteres, que es justo lo que
   * hace falta. Van las seis que se combinan con el juego precompuesto de abajo: grave, aguda,
   * circunflejo, tilde, diéresis y cedilla. Con chr() y no con escapes, por lo mismo que los
   * blancos.
   */
  const combinantes =
    "chr(768) || chr(769) || chr(770) || chr(771) || chr(776) || chr(807)";
  const sinMarcas = `translate(${col}, ${combinantes}, '')`;
  return (
    `btrim(regexp_replace(lower(translate(${sinMarcas}, '${ACENTOS}', '${SIN_ACENTOS}')), ` +
    `${blancos}, ' ', 'g'), ' ')`
  );
}
