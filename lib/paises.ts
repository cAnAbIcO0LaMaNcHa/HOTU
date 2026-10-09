/**
 * LA LISTA ISO DE PAÍSES, PARA EL FILTRO. SIN BASE DE DATOS.
 *
 * ============================================================
 * POR QUÉ NO VA EN LA TABLA countries
 * ============================================================
 *
 * Era mi plan y estaba mal. `countries` NO es una lista de consulta: es la CONFIGURACIÓN
 * OPERATIVA de los países donde HOTU funciona. Medido, sus seis columnas son todas NOT NULL —
 * code, name, default_language, currency, timezone y active, esta última con default true.
 *
 * Sembrar 249 filas ahí obligaría a inventarle a HOTU una moneda y una zona horaria para cada
 * país, y a dejarlos todos ACTIVOS por el default. Eso es afirmar que HOTU opera en 249 países.
 * Hoy opera en uno, y esa única fila —COL, COP, America/Bogota— dice algo verdadero que no hay
 * que diluir.
 *
 * El filtro no necesita nada de eso: necesita un código y un nombre. Así que es código, no
 * esquema, y esta pieza NO lleva migración.
 *
 * ============================================================
 * SOLO LOS CÓDIGOS ESTÁN ESCRITOS; LOS NOMBRES SALEN DE ICU
 * ============================================================
 *
 * Tipear 249 nombres en español es 249 oportunidades de escribir mal un acento, y además
 * quedarían congelados: los nombres de países cambian —Turquía pasó a Türkiye en 2022— y una
 * lista a mano no se entera.
 *
 * Intl.DisplayNames los da bien acentuados y actualizados con el ICU del runtime. Lo que NO
 * puede hacer es ENUMERAR las regiones —Intl.supportedValuesOf("region") no existe, medido— ni
 * aceptar alpha-3. Por eso los pares alpha-2:alpha-3 sí están escritos: son dos letras y tres,
 * no cambian nunca, y son lo único que ICU no da.
 *
 * ============================================================
 * ALPHA-3, PORQUE ES LO QUE GUARDAN LAS TABLAS
 * ============================================================
 *
 * country_code en las siete tablas de contenido guarda 'COL', no 'CO'. Un filtro que ofreciera
 * alpha-2 no matchearía ni una fila, y el síntoma sería una lista de países que nunca devuelve
 * resultados — sin ningún error.
 *
 * ============================================================
 * Y SI EL RUNTIME NO TIENE ICU COMPLETO, SE NOTA
 * ============================================================
 *
 * Con un ICU recortado, DisplayNames devuelve el código en vez del nombre: "CO" en lugar de
 * "Colombia". Una lista de 249 códigos de dos letras es inusable y NO tira ningún error, así
 * que hay una comprobación explícita. Es la misma familia que el log que afirma sin verificar.
 */

/**
 * alpha-2:alpha-3 de ISO 3166-1, las 249 asignadas oficialmente.
 *
 * En una sola cadena y no en un objeto literal para que entre de un vistazo y para que un
 * diff muestre qué cambió y no un bloque entero reindentado.
 */
const PARES =
  "AD:AND AE:ARE AF:AFG AG:ATG AI:AIA AL:ALB AM:ARM AO:AGO AQ:ATA AR:ARG AS:ASM AT:AUT " +
  "AU:AUS AW:ABW AX:ALA AZ:AZE BA:BIH BB:BRB BD:BGD BE:BEL BF:BFA BG:BGR BH:BHR BI:BDI " +
  "BJ:BEN BL:BLM BM:BMU BN:BRN BO:BOL BQ:BES BR:BRA BS:BHS BT:BTN BV:BVT BW:BWA BY:BLR " +
  "BZ:BLZ CA:CAN CC:CCK CD:COD CF:CAF CG:COG CH:CHE CI:CIV CK:COK CL:CHL CM:CMR CN:CHN " +
  "CO:COL CR:CRI CU:CUB CV:CPV CW:CUW CX:CXR CY:CYP CZ:CZE DE:DEU DJ:DJI DK:DNK DM:DMA " +
  "DO:DOM DZ:DZA EC:ECU EE:EST EG:EGY EH:ESH ER:ERI ES:ESP ET:ETH FI:FIN FJ:FJI FK:FLK " +
  "FM:FSM FO:FRO FR:FRA GA:GAB GB:GBR GD:GRD GE:GEO GF:GUF GG:GGY GH:GHA GI:GIB GL:GRL " +
  "GM:GMB GN:GIN GP:GLP GQ:GNQ GR:GRC GS:SGS GT:GTM GU:GUM GW:GNB GY:GUY HK:HKG HM:HMD " +
  "HN:HND HR:HRV HT:HTI HU:HUN ID:IDN IE:IRL IL:ISR IM:IMN IN:IND IO:IOT IQ:IRQ IR:IRN " +
  "IS:ISL IT:ITA JE:JEY JM:JAM JO:JOR JP:JPN KE:KEN KG:KGZ KH:KHM KI:KIR KM:COM KN:KNA " +
  "KP:PRK KR:KOR KW:KWT KY:CYM KZ:KAZ LA:LAO LB:LBN LC:LCA LI:LIE LK:LKA LR:LBR LS:LSO " +
  "LT:LTU LU:LUX LV:LVA LY:LBY MA:MAR MC:MCO MD:MDA ME:MNE MF:MAF MG:MDG MH:MHL MK:MKD " +
  "ML:MLI MM:MMR MN:MNG MO:MAC MP:MNP MQ:MTQ MR:MRT MS:MSR MT:MLT MU:MUS MV:MDV MW:MWI " +
  "MX:MEX MY:MYS MZ:MOZ NA:NAM NC:NCL NE:NER NF:NFK NG:NGA NI:NIC NL:NLD NO:NOR NP:NPL " +
  "NR:NRU NU:NIU NZ:NZL OM:OMN PA:PAN PE:PER PF:PYF PG:PNG PH:PHL PK:PAK PL:POL PM:SPM " +
  "PN:PCN PR:PRI PS:PSE PT:PRT PW:PLW PY:PRY QA:QAT RE:REU RO:ROU RS:SRB RU:RUS RW:RWA " +
  "SA:SAU SB:SLB SC:SYC SD:SDN SE:SWE SG:SGP SH:SHN SI:SVN SJ:SJM SK:SVK SL:SLE SM:SMR " +
  "SN:SEN SO:SOM SR:SUR SS:SSD ST:STP SV:SLV SX:SXM SY:SYR SZ:SWZ TC:TCA TD:TCD TF:ATF " +
  "TG:TGO TH:THA TJ:TJK TK:TKL TL:TLS TM:TKM TN:TUN TO:TON TR:TUR TT:TTO TV:TUV TW:TWN " +
  "TZ:TZA UA:UKR UG:UGA UM:UMI US:USA UY:URY UZ:UZB VA:VAT VC:VCT VE:VEN VG:VGB VI:VIR " +
  "VN:VNM VU:VUT WF:WLF WS:WSM YE:YEM YT:MYT ZA:ZAF ZM:ZMB ZW:ZWE " +
  /**
   * KOSOVO, Y XKX NO ES ISO 3166-1.
   *
   * ISO no le asignó código: la norma exige el reconocimiento de la ONU y Kosovo no lo
   * tiene. XK en alpha-2 y XKX en alpha-3 son los códigos DE FACTO que usan GeoNames, la
   * Comisión Europea y el FMI, y están en el rango XA-XZ que ISO reserva para usos
   * privados justamente para esto.
   *
   * Va aparte y con esta explicación porque el resto de la lista SÍ es ISO, y alguien que
   * valide esta tabla contra la norma va a encontrar que sobra uno. Que sobre a propósito
   * es distinto de que sobre por error.
   *
   * Lo que cuesta no incluirlo está medido: 65 ciudades de cities1000 quedarían afuera, y
   * un DJ de Pristina no tendría dónde decir de dónde es.
   */
  "XK:XKX";

export type Pais = { codigo: string; nombre: string };

let cache: Pais[] | null = null;

/**
 * Los países, ordenados por nombre en español.
 *
 * Se memoiza porque Intl.DisplayNames no es gratis y esto lo pide cada una de las siete
 * secciones en cada render del servidor.
 */
export function paises(): Pais[] {
  if (cache) return cache;

  const dn = new Intl.DisplayNames(["es"], { type: "region" });

  /**
   * LA COMPROBACIÓN DE ICU, contra un caso conocido y no contra "devolvió algo".
   *
   * Con un ICU recortado, dn.of("CO") devuelve "CO". Comparar contra el código atrapa eso;
   * comparar contra "no vacío" no atraparía nada, porque el código tampoco es vacío.
   */
  if (dn.of("CO") === "CO") {
    throw new Error(
      "El runtime no tiene ICU completo: Intl.DisplayNames devuelve el código en vez del " +
        "nombre. La lista de países saldría como 249 siglas de dos letras, inusable y sin " +
        "ningún error. Node necesita full-icu."
    );
  }

  const lista: Pais[] = [];
  for (const par of PARES.split(" ")) {
    const [a2, a3] = par.split(":");
    const nombre = dn.of(a2);
    /** Un código que ICU no conozca se SALTEA, no entra con su sigla de nombre. */
    if (!nombre || nombre === a2) continue;
    lista.push({ codigo: a3, nombre });
  }

  cache = lista.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  return cache;
}

/** El nombre de un alpha-3, o el propio código si no está en la lista. */
export function nombreDePais(alpha3: string): string {
  return paises().find((p) => p.codigo === alpha3)?.nombre ?? alpha3;
}
