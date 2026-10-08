/**
 * LA PUERTA DE LAS RUTAS DE MANTENIMIENTO, EN UN SOLO LUGAR.
 *
 * Dos rutas la usan —/api/mantenimiento-mail-outbox y /api/mantenimiento-convocatorias— y
 * va a haber más. Vive en su propio archivo por la misma razón que lib/collectives-gate.ts:
 * una regla de permisos derivada en dos lugares es una regla que un día se desincroniza, y la
 * mitad que se queda atrás es la que no se nota.
 *
 * ============================================================
 * DOS PUERTAS, CON PODERES DISTINTOS A PROPÓSITO
 * ============================================================
 *
 * A MANO, con MIGRATE_SECRET en la query: puede hacer dryRun y puede trabajar.
 * EL SCHEDULER, con Authorization: Bearer CRON_SECRET: SOLO puede trabajar.
 *
 * ============================================================
 * POR QUÉ UNA TERCERA LLAVE Y NO MIGRATE_SECRET
 * ============================================================
 *
 * No es prolijidad: es que NO HAY FORMA de que un cron de Vercel mande un query param
 * secreto. Los crons se declaran en vercel.json, que se COMMITEA al repo, así que poner
 * ?secret=... ahí publicaría la llave que altera el esquema de producción y que es la segunda
 * llave de la limpieza que borra pedidos y boletas.
 *
 * Vercel manda `Authorization: Bearer ${CRON_SECRET}` en cada invocación —verificado en su
 * documentación, no de memoria— y ese es el camino que no deja el secreto en ningún archivo.
 *
 * Y es la misma decisión que el repo ya tomó dos veces: MIGRATE_SECRET abre el esquema y la
 * plata, SMOKE_SECRET solo lee. Poderes distintos, llaves distintas.
 *
 * SIRVE IGUAL PARA UN GITHUB ACTION, y por eso este código no depende de cuál gane: un Action
 * manda el mismo header con la llave desde los secrets del repo. El disparador se elige
 * afuera; la puerta es la misma.
 *
 * ============================================================
 * FALLA CERRADO
 * ============================================================
 *
 * Si CRON_SECRET no está en el entorno, la puerta del scheduler NO EXISTE: `!cronSecret`
 * corta antes de comparar. El default de un camino automático que destruye contenido es "no",
 * igual que VENTA_ONLINE.
 *
 * Y el `!authHeader` no alcanza solo: sin el `!cronSecret`, un entorno sin la variable
 * compararía `"Bearer undefined"` contra el header, que es exactamente el tipo de comparación
 * que un día alguien satisface por accidente. Lo mismo del lado manual con MIGRATE_SECRET: si
 * faltara, `searchParams.get("secret") === undefined` sería true para una URL sin secreto.
 */

export type PuertaMantenimiento =
  | { ok: true; dryRun: boolean; via: "cron" | "manual" }
  | { ok: false; status: 400 | 401; error: string };

/**
 * Decide si la petición pasa y con qué poderes. NO lee la base y NO escribe nada: es una
 * función de la petición y del entorno, así que se puede probar sin candado.
 *
 * `admiteDryRun` existe para una ruta futura que no tenga nada que simular; hoy las dos lo
 * admiten. Con `false`, pedir dryRun por el camino manual se ignora en silencio porque no hay
 * nada que ignorar: no es una capacidad que se esté negando.
 */
export function abrirPuertaDeMantenimiento(
  request: Request,
  opciones: { admiteDryRun?: boolean } = {}
): PuertaMantenimiento {
  const admiteDryRun = opciones.admiteDryRun !== false;
  const { searchParams } = new URL(request.url);
  const dryRunPedido = searchParams.get("dryRun") === "1";

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const esCron = Boolean(cronSecret) && authHeader === `Bearer ${cronSecret}`;

  const migrateSecret = process.env.MIGRATE_SECRET;
  const esManual = Boolean(migrateSecret) && searchParams.get("secret") === migrateSecret;

  if (!esCron && !esManual) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  /**
   * EL CRON NO PUEDE PEDIR dryRun, Y SE LE DICE EN VEZ DE IGNORARLO.
   *
   * Ignorarlo sería peor: alguien que configure el cron apuntando a ?dryRun=1 creería estar
   * simulando y en realidad estaría trabajando. Y al revés —tratarlo como simulación— dejaría
   * un cron que corre todos los días sin hacer nada, que es el agujero que esta familia de
   * rutas vino a tapar: una política que no se ejecuta.
   *
   * Un 400 ruidoso al primer intento es la única de las tres opciones que se nota.
   */
  if (esCron && dryRunPedido) {
    return {
      ok: false,
      status: 400,
      error:
        "El scheduler no puede pedir dryRun: o simula y entonces el mantenimiento no pasa " +
        "nunca, o trabaja y entonces quien lo configuró creyó que simulaba. Sacá dryRun del " +
        "path del cron, o corré la simulación a mano con MIGRATE_SECRET.",
    };
  }

  return {
    ok: true,
    dryRun: admiteDryRun && dryRunPedido && esManual,
    via: esCron ? "cron" : "manual",
  };
}
