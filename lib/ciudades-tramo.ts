/**
 * EN QUÉ PUNTO DEL TRAMO ESTAMOS. Tres estados, y acá había dos — ese fue el bug.
 *
 * ============================================================
 * EL LOG AFIRMÓ ALGO QUE NO HABÍA MIRADO, Y SE VIO EN MAIN
 * ============================================================
 *
 * La línea decía:
 *
 *     yaEstaba ? "La recarga ya pasó: N de M filas tienen el nombre ASCII" : "..."
 *
 * y `yaEstaba` NO significa "la recarga pasó": significa "la expresión de clave ya es la
 * nueva". Entre el paso 2 (reexpresar) y el paso 3 (recargar) las dos cosas difieren, y ahí
 * el dryRun de main imprimió "La recarga ya pasó: 0 de 171174 fila(s)" — que es falso y
 * además se contradice solo en la misma oración.
 *
 * Es exactamente la familia que AGENTS.md persigue: un log que afirma sin verificar. Y el
 * mecanismo es el de siempre, dos estados distintos colapsados en un booleano. Lo que lo
 * vuelve peligroso es que el estado intermedio es JUSTO el que alguien mira para decidir si
 * ya puede recargar.
 *
 * ============================================================
 * POR QUÉ ES UNA FUNCIÓN PURA Y NO UN if ADENTRO DEL HANDLER
 * ============================================================
 *
 * Para poder probarla. El estado del medio sólo existe entre dos pasos manuales, así que
 * reproducirlo contra la base significaría vaciar ascii_nombre en las 171.174 filas y volver a
 * cargarlas. Una prueba que cuesta dos minutos y toca los datos es una prueba que no se corre.
 *
 * Con la decisión afuera, las tres ramas se ejercitan en milisegundos y sin tocar nada, que es
 * lo que hace que esta sea la segunda vez y no la tercera.
 */
export type PuntoDelTramo = "sin-reexpresar" | "falta-recargar" | "recargada";

export function estadoDeRecarga(e: {
  expresionAplicada: boolean;
  conAsciiNombre: number;
  filas: number;
}): { estado: PuntoDelTramo; mensaje: string } {
  if (!e.expresionAplicada) {
    return {
      estado: "sin-reexpresar",
      mensaje:
        "NO CAMBIA NINGUNA CLAVE AL CORRERSE: ascii_nombre nace en NULL, así que el COALESCE " +
        "cae al nombre local y clave queda idéntica. Las claves mejoran después, con la recarga.",
    };
  }
  if (e.conAsciiNombre === 0) {
    return {
      estado: "falta-recargar",
      mensaje:
        "FALTA RECARGAR, Y SIN ESO ESTO NO ARREGLÓ NADA: la expresión de clave ya sale de " +
        `ascii_nombre, pero la columna está VACÍA en las ${e.filas} filas, así que el COALESCE ` +
        "sigue cayendo al nombre local. Corré scripts/cargar-ciudades.mjs.",
    };
  }
  return {
    estado: "recargada",
    mensaje:
      `La recarga ya pasó: ${e.conAsciiNombre} de ${e.filas} fila(s) tienen el nombre ASCII de ` +
      "GeoNames." +
      (e.conAsciiNombre < e.filas
        ? ` Faltan ${e.filas - e.conAsciiNombre}, así que quedó a medias: volvé a correr el cargador.`
        : ""),
  };
}
