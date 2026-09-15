/**
 * POST /api/accounts — crear una cuenta con email y contraseña.
 *
 * La cuenta y nada más: no crea perfil de DJ, no activa ningún rol. Una
 * sola cuenta con roles activables es el modelo del proyecto, y
 * registrarse no te convierte en DJ.
 *
 * La respuesta es la misma exista o no el email. Toda la lógica de por
 * qué vive en lib/accounts.ts, incluido el costo de scrypt que se paga
 * aunque no se escriba nada.
 *
 * NO inicia sesión. Hacerlo solo cuando la cuenta es nueva sería
 * exactamente la filtración que la respuesta única evita. El formulario
 * manda al ingreso, que ya es indistinguible entre "no existe" y
 * "contraseña equivocada" gracias al DUMMY_HASH de verifyCredentials.
 */

import { NextResponse } from "next/server";
import { createAccount } from "@/lib/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  const result = await createAccount({
    email: body.email,
    password: body.password,
    displayName: body.displayName,
    birthDate: body.birthDate,
    consent: body.consent,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  // 200 y no 201: un 201 con Location afirmaría que se creó algo, y a
  // veces no se creó nada. El código de estado no puede delatar lo que
  // el cuerpo se calla.
  return NextResponse.json({ ok: true });
}
