// Reparto de CONSULTAS y de VENTAS entre los canales de la hoja "1. Plan 2027"
// (Mkt / Com / WEB / Otros), partido en mes alto y mes normal.
//
// El canal NO sale de leads.cat_channel sino de la CATEGORIA que ya calcula la
// vista vw_r_prospectos: es la columna Z de la hoja "3. SYSTEM" del libro
// "R Prospectos 2026", la clasificacion que Planeamiento ya usa.
//
//   CCN / CCL / CCC -> Com    (la consulta trae estrategia comercial: la levanta el asesor)
//   CMN / CML / CMC -> Mkt    (la consulta trae palabra de campana de marketing)
//   CON / COL / COC -> Otros  (ni estrategia ni palabra: entro sola)
//   CNF / CLF / CCF -> Fundacion, que la hoja no tiene: se reporta aparte para
//                      que no se disuelva dentro de Otros sin que nadie lo vea.
// La tercera letra es el momento del cliente (N nuevo, L lead, C comunidad) y no
// cambia el canal.
//
// Las dos mitades se cuentan en tablas distintas a proposito:
//  - La VENTA con consulta es el lead con pay_date. NO se usa leads.enrollment_id:
//    enero y febrero tienen CERO enrollments enlazados (el modulo comercial recien
//    empezo a enlazar en marzo) y por ahi se perdia la mitad de la temporada alta.
//    Con pay_date los ocho meses estan completos (543 ventas en enero).
//  - La VENTA WEB no tiene consulta: de 4314 leads con pago, solo 6 vienen de un
//    agente web. Por eso el bloque de Consultas de la hoja no tiene columna WEB y
//    el de Ventas si. Se cuenta aparte, por agent_origin, sobre el mismo universo
//    de "primer pago sin modalidad Online" que alimenta "2. Clas. prog.".
import fs from 'node:fs'
import pg from 'pg'

const ANIO = Number(process.argv[2] ?? 2026)
const MES_FINAL = Number(process.argv[3] ?? 8)
const MODALIDAD_ONLINE = 2623
const INTENTOS = 3

// La categoria es un codigo de 3 letras; las dos primeras dicen el canal.
const CANAL_POR_PREFIJO = { CC: 'Com', CM: 'Mkt', CO: 'Otros' }
const CATEGORIAS_DE_FUNDACION = new Set(['CNF', 'CLF', 'CCF'])

export function canalDeCategoria (categoria) {
  if (!categoria) return 'Otros'
  if (CATEGORIAS_DE_FUNDACION.has(categoria)) return 'Fundacion'
  if (categoria === 'WEB') return 'WEB'
  return CANAL_POR_PREFIJO[categoria.slice(0, 2)] ?? 'Otros'
}

const urlDeProduccion = () =>
  fs.readFileSync('.env.bak-produccion', 'utf8').match(/^DATABASE_URL=(.+)$/m)[1].trim()

async function conectarConReintento () {
  for (let intento = 1; intento <= INTENTOS; intento++) {
    const cliente = new pg.Client({ connectionString: urlDeProduccion(), connectionTimeoutMillis: 10000 })
    try {
      await cliente.connect()
      return cliente
    } catch (error) {
      await cliente.end().catch(() => {})
      if (intento === INTENTOS) throw new Error(`tunel SSH caido tras ${INTENTOS} intentos: ${error.message}`)
    }
  }
}

// Mes alto = enero, febrero, marzo y julio, igual que el resto de la hoja.
const temporalidadDe = columna =>
  `CASE WHEN EXTRACT(month FROM ${columna}) IN (1,2,3,7) THEN 'ALTO' ELSE 'NORMAL' END`

const enElPeriodo = columna =>
  `${columna} >= make_date($1, 1, 1) AND ${columna} < make_date($1, $2, 1) + INTERVAL '1 month'`

const cliente = await conectarConReintento()
const periodo = [ANIO, MES_FINAL]

const consultas = await cliente.query(`
  SELECT v.categoria, ${temporalidadDe('l.first_contact_date')} AS temporalidad, COUNT(*)::int AS n
    FROM public.leads l
    JOIN public.vw_r_prospectos v ON v.vacio_obligatorio = l.lead_id::varchar
   WHERE ${enElPeriodo('l.first_contact_date')}
   GROUP BY 1, 2`, periodo)

const ventasConConsulta = await cliente.query(`
  SELECT v.categoria, ${temporalidadDe('l.pay_date')} AS temporalidad, COUNT(*)::int AS n
    FROM public.leads l
    JOIN public.vw_r_prospectos v ON v.vacio_obligatorio = l.lead_id::varchar
   WHERE ${enElPeriodo('l.pay_date')}
   GROUP BY 1, 2`, periodo)

const ventasWeb = await cliente.query(`
  WITH primer_pago AS (
    SELECT DISTINCT ON (pa.enrollment_id) pa.enrollment_id, pa.payment_date
      FROM public.payments pa WHERE pa.active = 'Y'
     ORDER BY pa.enrollment_id, pa.payment_date, pa.payment_id
  )
  SELECT 'WEB' AS categoria, ${temporalidadDe('pp.payment_date')} AS temporalidad, COUNT(*)::int AS n
    FROM primer_pago pp
    JOIN public.enrollments e       ON e.enrollment_id = pp.enrollment_id
    JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
    JOIN public.programs p          ON p.program_id = pv.program_id
   WHERE e.active = 'Y' AND e.agent_origin = 'WEB'
     AND p.cat_model_modality <> $3
     AND ${enElPeriodo('pp.payment_date')}
   GROUP BY 1, 2`, [...periodo, MODALIDAD_ONLINE])

await cliente.end()

const CANALES = ['Mkt', 'Com', 'WEB', 'Otros', 'Fundacion']

function repartir (filas) {
  const porTemporalidad = new Map()
  for (const fila of filas) {
    const canal = canalDeCategoria(fila.categoria)
    const canales = porTemporalidad.get(fila.temporalidad) ?? new Map()
    canales.set(canal, (canales.get(canal) ?? 0) + fila.n)
    porTemporalidad.set(fila.temporalidad, canales)
  }
  return porTemporalidad
}

const porcentaje = (parte, total) => total ? `${(100 * parte / total).toFixed(1)}%` : ''

console.log('QUE;TEMPORALIDAD;' + CANALES.join(';') + ';TOTAL')
const bloques = [
  ['CONSULTAS', consultas.rows],
  ['VENTAS', [...ventasConConsulta.rows, ...ventasWeb.rows]]
]
for (const [que, filas] of bloques) {
  const reparto = repartir(filas)
  for (const temporalidad of ['ALTO', 'NORMAL']) {
    const canales = reparto.get(temporalidad) ?? new Map()
    const total = [...canales.values()].reduce((a, n) => a + n, 0)
    console.log([que, temporalidad,
      ...CANALES.map(c => `${canales.get(c) ?? 0} (${porcentaje(canales.get(c) ?? 0, total)})`),
      total].join(';'))
  }
}

// La conversion por canal solo tiene sentido donde hay consulta: WEB no la tiene.
console.error('\n-- conversion por canal (ventas con consulta / consultas)')
const consultasPor = repartir(consultas.rows)
const ventasPor = repartir(ventasConConsulta.rows)
for (const temporalidad of ['ALTO', 'NORMAL']) {
  const c = consultasPor.get(temporalidad); const v = ventasPor.get(temporalidad)
  console.error(`--  ${temporalidad.padEnd(6)} ` +
    ['Mkt', 'Com', 'Otros'].map(x => `${x} ${porcentaje(v.get(x) ?? 0, c.get(x) ?? 0)}`).join('  '))
}
