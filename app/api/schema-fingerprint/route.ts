/**
 * GET /api/schema-fingerprint?secret=SMOKE_SECRET — la forma del esquema.
 *
 * Devuelve tablas con sus columnas (tipo, nullabilidad, default), los
 * constraints y los índices, todo con su DEFINICIÓN completa. Sirve para
 * comparar dev contra main y ver si a main le falta algo.
 *
 * ============================================================
 * POR QUÉ UNA RUTA Y NO UN SCRIPT QUE SE CONECTE A LAS DOS
 * ============================================================
 *
 * El DATABASE_URL de main no está en localhost —a propósito: es lo que
 * hace que "todo contra dev" sea una garantía y no una intención—. Un
 * script que comparara las dos branches necesitaría esa credencial acá,
 * y tenerla a mano es exactamente el accidente que la ausencia previene.
 *
 * Con esta ruta la comparación se hace por HTTP: el script le pregunta a
 * localhost y a producción, y ninguna credencial de main sale de Vercel.
 *
 * ============================================================
 * ESTO NO REEMPLAZA A /api/smoke, Y NO PODRÍA
 * ============================================================
 *
 * Un diff de esquema dice que a main le falta una columna. No dice si el
 * CÓDIGO la usa, ni qué página se cae. Y al revés: hay diferencias
 * legítimas —tablas que solo existen en dev, como zz_test_lock— que no
 * son un problema.
 *
 * El smoke es el que responde la pregunta que importa ("¿alguna lectura
 * revienta?"). Esto responde la otra ("¿en qué se diferencian?"), que es
 * la que dice DÓNDE mirar cuando el smoke falla.
 *
 * No devuelve ni una fila de datos: solo nombres y definiciones.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (!process.env.SMOKE_SECRET || searchParams.get("secret") !== process.env.SMOKE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL!);

  try {
    const columnas = await sql`
      SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, column_name
    `;
    const constraints = await sql`
      SELECT c.conrelid::regclass::text AS tabla, c.conname, c.contype,
             pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
      ORDER BY 1, 2
    `;
    const indices = await sql`
      SELECT tablename, indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' ORDER BY tablename, indexname
    `;

    /** tabla -> columna -> "tipo|null|default". Una línea por columna. */
    const tablas: Record<string, Record<string, string>> = {};
    for (const c of columnas) {
      const t = c.table_name as string;
      tablas[t] ??= {};
      tablas[t][c.column_name as string] =
        `${c.data_type}|${c.is_nullable === "YES" ? "null" : "notnull"}|${c.column_default ?? "-"}`;
    }

    return NextResponse.json({
      ok: true,
      tablas,
      constraints: constraints.map((c) => `${c.tabla}.${c.conname} [${c.contype}] ${c.def}`),
      indices: indices.map((i) => `${i.tablename}.${i.indexname} ${i.indexdef}`),
      resumen: {
        tablas: Object.keys(tablas).length,
        columnas: columnas.length,
        constraints: constraints.length,
        indices: indices.length,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
