// Solo lectura: clasifica por CAUSA las inscripciones cuyo total_amount no
// coincide con la suma de sus cuotas. Sin esta separacion un backfill ciego
// "total = suma de cuotas" le perdonaria deuda real a los alumnos a los que
// simplemente les faltan cuotas por generar.
//
//   node scripts/triaje-descuadres.mjs            # produccion (tunel)
//   node scripts/triaje-descuadres.mjs --local    # BD de pruebas
//   node scripts/triaje-descuadres.mjs --detalle CATEGORIA
import fs from 'fs'
import pg from 'pg'

const local = process.argv.includes('--local')
// Sin --detalle, indexOf devuelve -1 y argv[0] es la ruta de node: hay que
// preguntar por la bandera antes de leer su valor.
const iDetalle = process.argv.indexOf('--detalle')
const detalle = iDetalle === -1 ? null : process.argv[iDetalle + 1]
let url = 'postgresql://postgres:postgres@127.0.0.1:5433/system_erp_dev'
if (!local) {
  const bak = fs.readFileSync(new URL('../.env.bak-produccion', import.meta.url), 'utf8')
  url = bak.match(/^\s*#?\s*DATABASE_URL=(postgresql:\/\/[^\s]+55432[^\s]*)/m)?.[1]
}
const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 15000, keepAlive: true })

const consultar = async (sql, intentos = 5) => {
  for (let i = 1; i <= intentos; i++) {
    try { return await pool.query(sql) } catch (e) {
      console.log(`intento ${i}/${intentos}: ${e.message}`)
      if (i === intentos) throw e
    }
  }
}

// Las categorias son excluyentes y se evaluan en orden (primer CASE que matchea).
const SQL = `
WITH base AS (
  SELECT e.enrollment_id, e.list_price, e.discount_amount, e.total_amount,
         e.parent_enrollment_id, e.notes, e.registration_date::date AS registro,
         c.cuotas, c.suma, c.pagadas, c.cobrado,
         cp.alias AS plan, cf.alias AS fico
    FROM public.enrollments e
    JOIN LATERAL (
      SELECT COUNT(*)::int AS cuotas,
             COALESCE(SUM(pi.amount), 0)::numeric AS suma,
             COUNT(*) FILTER (WHERE cs.alias IN ('we_inst_paid','we_payment_status_paid'))::int AS pagadas,
             COALESCE(SUM(pi.amount) FILTER (WHERE cs.alias IN ('we_inst_paid','we_payment_status_paid')), 0)::numeric AS cobrado
        FROM public.payment_installments pi
        LEFT JOIN public."catalog" cs ON cs.catalog_id = pi.cat_status
       WHERE pi.enrollment_id = e.enrollment_id
    ) c ON TRUE
    LEFT JOIN public."catalog" cp ON cp.catalog_id = e.cat_payment_plan
    LEFT JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
   WHERE e.active = 'Y' AND c.cuotas > 0
     AND e.total_amount IS DISTINCT FROM c.suma
), clasificado AS (
  SELECT b.*,
    CASE
      -- El total esta en 0 pero hay cuotas con monto: la cabecera nunca se lleno.
      WHEN b.total_amount = 0 AND b.suma > 0                     THEN 'A_total_en_cero'
      -- Plan en cuotas con UNA sola cuota: faltan cuotas por generar. El total
      -- es el bueno; tocarlo perdonaria la deuda.
      WHEN b.plan = 'we_payment_way_installments' AND b.cuotas = 1 THEN 'B_faltan_cuotas'
      -- Importadas de la migracion masiva: descuadre heredado del Excel.
      WHEN COALESCE(b.notes, '') LIKE '%masiva FICO%'            THEN 'C_importacion_masiva'
      -- Las cuotas suman MENOS que el total: es el caso de editar una cuota.
      WHEN b.suma < b.total_amount                                THEN 'D_cuota_editada_a_la_baja'
      ELSE 'E_cuotas_suman_mas'
    END AS categoria
  FROM base b
)
SELECT * FROM clasificado
`

if (detalle) {
  const { rows } = await consultar(`${SQL} WHERE categoria = '${detalle}' ORDER BY abs(total_amount - suma) DESC`)
  console.log(`categoria ${detalle}:`, rows.length, 'inscripciones')
  console.table(rows.map(r => ({
    id: r.enrollment_id, lista: r.list_price, dscto: r.discount_amount, total: r.total_amount,
    cuotas: r.cuotas, suma: r.suma, pagadas: r.pagadas, cobrado: r.cobrado,
    dif: r.diferencia ?? (Number(r.total_amount) - Number(r.suma)).toFixed(2),
    plan: r.plan?.replace('we_payment_way_', ''), fico: r.fico?.replace('we_enrollment_status_', ''),
    hijo: r.parent_enrollment_id ? 'si' : '', registro: String(r.registro).slice(0, 10)
  })))
} else {
  const { rows } = await consultar(`
    SELECT categoria, COUNT(*)::int AS inscripciones,
           SUM(abs(total_amount - suma))::numeric(12,2) AS diferencia_total
      FROM (${SQL}) x GROUP BY categoria ORDER BY categoria`)
  console.log(local ? '(BD LOCAL)' : '(PRODUCCION)')
  console.table(rows)
  console.log('\\nDetalle de una categoria: node scripts/triaje-descuadres.mjs --detalle A_total_en_cero')
}

await pool.end()
