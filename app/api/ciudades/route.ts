/**
 * GET /api/ciudades?pais=COL&q=bogo — el autocompletado de ciudades.
 *
 * Devuelve hasta 8 ciudades del país pedido cuyo nombre —local o en español— empieza con la
 * consulta, ordenadas por población. Es lo que alimenta el selector de los cinco formularios
 * que antes tenían un campo de texto libre.
 *
 * ============================================================
 * EL PAÍS ES OBLIGATORIO Y SIN PAÍS ES 400, NO UNA BÚSQUEDA GLOBAL
 * ============================================================
 *
 * Está medido en lib/ciudades.ts: con país la consulta es un Index Scan de 0,285 ms, y sin
 * país es un Seq Scan de 113 ms que descarta 170.739 filas. Una ruta que acepte "buscá en
 * todo el mundo" es una ruta que recorre la tabla entera en cada tecla de cada visitante.
 *
 * Así que falta de país es 400 y no un valor por omisión. Un default —'COL', por ejemplo—
 * sería peor que el error: devolvería resultados plausibles para la consulta equivocada, y el
 * que buscaba una ciudad de México vería una lista de Colombia sin entender por qué.
 *
 * ============================================================
 * PIDE SESIÓN
 * ============================================================
 *
 * No por el dato —cities es GeoNames, público y con licencia CC BY 4.0— sino porque los cinco
 * formularios que la usan están todos detrás del login, así que exigirla no le quita nada a
 * nadie y le saca a un anónimo la posibilidad de pedir 171.174 filas de a ocho.
 *
 * El FILTRO público de ciudad NO pasa por acá: sus opciones salen de lo que el contenido ya
 * usa, calculadas en el server component. Si algún día un filtro necesita buscar en vivo sin
 * sesión, eso es una decisión aparte y hay que tomarla a la vista, no descubrirla porque la
 * ruta ya estaba abierta.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buscarCiudades, paisValido, patronDe, MINIMO_PARA_BUSCAR } from "@/lib/ciudades";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const pais = (searchParams.get("pais") ?? "").trim().toUpperCase();
  const q = searchParams.get("q") ?? "";

  if (!pais) {
    return NextResponse.json(
      { error: "Falta el país. La búsqueda de ciudades es siempre dentro de un país." },
      { status: 400 }
    );
  }
  if (!paisValido(pais)) {
    return NextResponse.json(
      { error: `No conozco el país ${pais}. Tiene que ser un código de tres letras.` },
      { status: 400 }
    );
  }

  /**
   * Una consulta demasiado corta devuelve una lista vacía con 200, NO un 400.
   *
   * El selector pregunta en cada tecla, así que el primer carácter de toda búsqueda cae acá.
   * Un 400 ahí sería un error en la consola del navegador por cada palabra que alguien
   * escribe, y a los dos días nadie mira esa consola.
   */
  if (!patronDe(q)) {
    return NextResponse.json({ ciudades: [], minimo: MINIMO_PARA_BUSCAR });
  }

  try {
    const ciudades = await buscarCiudades(pais, q);
    return NextResponse.json({ ciudades });
  } catch (e) {
    console.error("[api/ciudades]", e);
    return NextResponse.json({ error: "No pude buscar ciudades." }, { status: 500 });
  }
}
