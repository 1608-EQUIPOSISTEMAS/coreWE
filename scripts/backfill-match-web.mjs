// Backfill del Match WEB en PRODUCCION.
//
// Completa el lado del lead en las ventas WEB que FICO ya atribuyo a un asesor:
// engancha la consulta que ese MISMO asesor registro para ese alumno y ese
// programa, la marca como "Pago" y le pone la fecha del primer pago. Es el
// trabajo manual que hasta ahora se hacia venta por venta.
//
// Solo toca lo inequivoco: la consulta tiene que ser del asesor que FICO ya
// eligio. Nunca inventa una atribucion que FICO no hizo.
//
// Uso:
//   node scripts/backfill-match-web.mjs --dry    # reporta, no escribe
//   node scripts/backfill-match-web.mjs          # aplica
//
// El tunel SSH se cae seguido: todo va en UNA conexion, con reintento y con
// guardas idempotentes (re-correrlo no duplica nada).
import fs from 'fs'
import pg from 'pg'

const DRY = process.argv.includes('--dry')

// La URL de produccion vive en .env.bak-produccion, no en .env (que apunta a
// pruebas). Se lee explicitamente para no depender de cual .env este activo.
const PROD_URL = fs.readFileSync(new URL('../.env.bak-produccion', import.meta.url), 'utf8')
  .split('\n').find(l => l.startsWith('DATABASE_URL='))?.slice('DATABASE_URL='.length).trim()
if (!PROD_URL) throw new Error('No se encontro DATABASE_URL en .env.bak-produccion')

// Ventas WEB ya atribuidas por FICO cuya consulta de origen sigue suelta.
//
// Cuando el asesor tiene mas de una consulta libre para el mismo alumno y
// programa, gana la mas reciente ANTERIOR O IGUAL al primer pago: la posterior
// al pago no pudo originar la venta (venta 3387: pago el 06/06, segunda
// consulta el 10/07). Las consultas borradas o anuladas no compiten (venta
// 3634: la mas reciente estaba Eliminada).
// El cruce es por PROGRAMA, no por version exacta: el asesor registra contra la
// version del cronograma y la web vende la que esta en vivo (venta 16427:
// PC-CP-01 contra la consulta en PC-CP-02).
const CANDIDATAS = `
  WITH ventas AS (
    SELECT e.enrollment_id, pv.program_id, e.seller_agent_id,
           (SELECT py.payment_date::date FROM payments py
             WHERE py.enrollment_id = e.enrollment_id AND py.active = 'Y'
             ORDER BY py.payment_date ASC LIMIT 1) AS primer_pago,
           (SELECT pc.value FROM person_contacts pc
             WHERE pc.person_id = per.person_id
               AND pc.cat_way_contact = (SELECT catalog_id FROM catalog WHERE alias='we_way_contact_phone' LIMIT 1)
               AND pc.active = 'Y'
             ORDER BY pc.registration_date DESC LIMIT 1) AS phone
      FROM enrollments e
      JOIN customers cust ON cust.customer_id = e.customer_id
      JOIN persons   per  ON per.person_id    = cust.person_id
      JOIN program_versions pv ON pv.program_version_id = e.program_version_id
     WHERE e.agent_origin = 'WEB'
       AND e.seller_agent_id IS NOT NULL
       AND e.active = 'Y'
       AND NOT EXISTS (SELECT 1 FROM leads lx WHERE lx.enrollment_id = e.enrollment_id)
  )
  SELECT v.enrollment_id, v.seller_agent_id, v.primer_pago, u.alias,
         ARRAY_AGG(l.lead_id ORDER BY (l.registration_date::date <= v.primer_pago) DESC,
                                      l.registration_date DESC) AS leads,
         COUNT(*) AS n
    FROM ventas v
    JOIN users u ON u.user_id = v.seller_agent_id
    JOIN leads l ON l.origin_phone         = v.phone
                AND l.user_registration_id = v.seller_agent_id
                AND l.enrollment_id IS NULL
                AND l.active = 'Y'
    JOIN program_versions lpv ON lpv.program_version_id = l.program_version_id
                             AND lpv.program_id         = v.program_id
    LEFT JOIN catalog cs ON cs.catalog_id = l.cat_status_lead
   WHERE v.primer_pago IS NOT NULL
     AND COALESCE(cs.alias, '') NOT IN ('we_lead_status_deleted', 'we_lead_status_annulment')
   GROUP BY v.enrollment_id, v.seller_agent_id, v.primer_pago, u.alias
   ORDER BY v.enrollment_id`

// Mismo UPDATE que hace el flujo nuevo (repo.linkLeadToEnrollment). La guarda
// enrollment_id IS NULL lo hace idempotente.
const ENGANCHAR = `
  UPDATE leads
     SET enrollment_id        = $2,
         cat_status_lead      = (SELECT catalog_id FROM catalog WHERE alias = 'we_lead_status_bought' LIMIT 1),
         pay_date             = COALESCE(
                                  pay_date,
                                  (SELECT py.payment_date::date FROM payments py
                                    WHERE py.enrollment_id = $2 AND py.active = 'Y'
                                    ORDER BY py.payment_date ASC LIMIT 1)
                                ),
         user_modification_id = $3,
         modification_date    = NOW()
   WHERE lead_id = $1 AND enrollment_id IS NULL`

async function conectar (intentos = 4) {
  for (let i = 1; i <= intentos; i++) {
    const client = new pg.Client({ connectionString: PROD_URL, connectionTimeoutMillis: 15000, keepAlive: true })
    try { await client.connect(); return client } catch (e) {
      console.error(`[intento ${i}/${intentos}] ${e.message}`)
      await client.end().catch(() => {})
      if (i === intentos) throw e
    }
  }
}

const client = await conectar()
try {
  // Un usuario con rol permitido: trg_check_lead_modification_permission exige
  // ser el dueno del lead o ADMIN/FICO/LIDER_COMERCIAL/GERENCIA.
  const { rows: [actor] } = await client.query(`
    SELECT ur.user_id FROM user_roles ur JOIN rol r ON r.rol_id = ur.rol_id
     WHERE UPPER(r.alias) = 'ADMIN' ORDER BY ur.user_id LIMIT 1`)
  if (!actor) throw new Error('No hay usuario ADMIN para firmar el backfill')

  const { rows } = await client.query(CANDIDATAS)
  const inequivocas = rows.filter(r => Number(r.n) === 1)
  const multiples   = rows.filter(r => Number(r.n) > 1)

  console.log(`ventas WEB atribuidas con consulta suelta del MISMO asesor: ${rows.length}`)
  console.log(`  con una sola consulta (inequivocas): ${inequivocas.length}`)
  console.log(`  con varias consultas del mismo asesor: ${multiples.length} (se toma la mas reciente)`)
  console.table(rows.map(r => ({
    venta: r.enrollment_id, asesor: r.alias, consultas: r.n,
    lead: r.leads[0], primer_pago: new Date(r.primer_pago).toISOString().slice(0, 10)
  })))

  if (DRY) { console.log('\n--dry: no se escribio nada.'); process.exit(0) }

  await client.query('BEGIN')
  let enganchados = 0
  for (const r of rows) {
    const { rowCount } = await client.query(ENGANCHAR, [r.leads[0], r.enrollment_id, actor.user_id])
    if (rowCount) enganchados++
    else console.warn(`  venta ${r.enrollment_id}: lead ${r.leads[0]} ya estaba enganchado, se omite`)
  }
  await client.query('COMMIT')
  console.log(`\nOK: ${enganchados} consulta(s) enganchada(s) y marcada(s) como Pago.`)

  const { rows: sobran } = await client.query(CANDIDATAS)
  console.log(sobran.length === 0 ? 'OK: no queda ninguna venta WEB atribuida con la consulta suelta.'
                                  : `Quedan ${sobran.length} sin enganchar.`)
} catch (e) {
  await client.query('ROLLBACK').catch(() => {})
  throw e
} finally {
  await client.end().catch(() => {})
}
