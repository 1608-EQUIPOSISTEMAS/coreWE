// Auditoria de datos de las ventas con Orden de Servicio / Orden de Compra.
//
// No mira la clasificacion (eso es probe-canal-b2b-comercial.mjs), mira si la
// DATA se sostiene sola: aritmetica del precio, cuotas contra total, cobranza,
// empresa detras del documento, llegada a Odoo y correo. Cada bloque imprime
// solo lo que NO cuadra.
import { q, pool } from './prod-db.mjs'

const OS_OP = `cbd.alias IN ('we_enrollment_b2b_doctype_service_order',
                             'we_enrollment_b2b_doctype_purchase_order')`

const ventas = (await q(`
  SELECT e.enrollment_id, e.registration_date::date AS fecha, e.total_amount::numeric AS total,
         e.discount_amount::numeric AS descuento, e.list_price::numeric AS lista,
         cbd.alias AS doctype, cts.alias AS estado, cpl.alias AS plan,
         u.alias AS asesor, e.agent_origin, e.b2b_contract_id, e.odoo_user_id, e.odoo_order_id,
         e.flag_send, e.student_attachment_url IS NOT NULL AS tiene_adjunto,
         l.company_id, l.company_name, comp.razon_social, l.b2b AS lead_b2b,
         pv.abbreviation AS programa, pe.specific_code, pe.start_date::date AS inicio,
         per.person_id, per.document_number AS dni,
         TRIM(concat_ws(' ', per.first_name, per.last_name)) AS alumno,
         (SELECT COUNT(*)::int FROM enrollments ch WHERE ch.parent_enrollment_id = e.enrollment_id AND ch.active='Y') AS hijos,
         COALESCE((SELECT SUM(pi.amount) FROM payment_installments pi WHERE pi.enrollment_id = e.enrollment_id), 0)::numeric AS suma_cuotas,
         COALESCE((SELECT COUNT(*) FROM payment_installments pi WHERE pi.enrollment_id = e.enrollment_id), 0)::int AS n_cuotas,
         COALESCE((SELECT SUM(pi.amount) FROM payment_installments pi
                     JOIN catalog cs ON cs.catalog_id = pi.cat_status AND cs.alias IN ('we_inst_paid','we_payment_status_paid')
                    WHERE pi.enrollment_id = e.enrollment_id), 0)::numeric AS cobrado,
         (SELECT MIN(pi.due_date)::date FROM payment_installments pi
            JOIN catalog cs ON cs.catalog_id = pi.cat_status AND cs.alias NOT IN ('we_inst_paid','we_payment_status_paid')
           WHERE pi.enrollment_id = e.enrollment_id) AS vence_pendiente,
         COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.enrollment_id = e.enrollment_id AND p.active='Y'), 0)::numeric AS pagos
    FROM enrollments e
    JOIN catalog cbd ON cbd.catalog_id = e.cat_b2b_doctype
    JOIN catalog cf  ON cf.catalog_id = e.cat_fico_status AND cf.alias = 'we_enrollment_status_checked'
    JOIN customers cu ON cu.customer_id = e.customer_id
    JOIN persons per ON per.person_id = cu.person_id
    LEFT JOIN catalog cts ON cts.catalog_id = e.cat_type_status
    LEFT JOIN catalog cpl ON cpl.catalog_id = e.cat_payment_plan
    LEFT JOIN users u ON u.user_id = e.seller_agent_id
    LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
    LEFT JOIN companies comp ON comp.company_id = l.company_id
    LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
   WHERE e.active = 'Y' AND ${OS_OP}
   ORDER BY e.registration_date, e.enrollment_id`)).rows

const REGLA_MONTO_REAL = '2026-08-11' // desde aqui OS/OP nacen con monto real + cuota pendiente
const hoy = new Date().toISOString().slice(0, 10)
const num = (v) => Number(v)
const f = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null)

const hallazgos = []
const anota = (tipo, v, detalle) => hallazgos.push({ tipo, id: v.enrollment_id, alumno: v.alumno, detalle })

for (const v of ventas) {
  const nueva = f(v.fecha) >= REGLA_MONTO_REAL

  if (num(v.lista) - num(v.descuento) !== num(v.total)) {
    anota('aritmetica rota', v, `lista ${v.lista} - dscto ${v.descuento} != total ${v.total}`)
  }
  if (v.n_cuotas > 0 && num(v.suma_cuotas) !== num(v.total)) {
    anota('cuotas != total', v, `${v.n_cuotas} cuota(s) = ${v.suma_cuotas}, total ${v.total}`)
  }
  if (num(v.total) > 0 && v.n_cuotas === 0) anota('venta sin cuotas', v, `total ${v.total} sin plan de pago`)
  if (num(v.pagos) > num(v.total)) anota('pagos > total', v, `pagos ${v.pagos} vs total ${v.total}`)
  if (nueva && num(v.total) === 0) {
    anota('pago cero despues de la regla nueva', v, `${v.doctype.replace('we_enrollment_b2b_doctype_', '')} del ${f(v.fecha)} con total 0`)
  }
  if (v.vence_pendiente && f(v.vence_pendiente) < hoy) {
    anota('cuota vencida', v, `vencio ${f(v.vence_pendiente)}, cobrado ${v.cobrado} de ${v.total}`)
  }
  if (!v.b2b_contract_id && !v.company_id && !v.company_name) {
    anota('sin empresa', v, `${v.doctype.replace('we_enrollment_b2b_doctype_', '')} sin contrato ni empresa en el lead`)
  }
  if (!v.odoo_user_id) anota('sin usuario Odoo', v, 'no llego al campus virtual')
  if (v.dni && /^99000/.test(v.dni)) anota('DNI provisional', v, v.dni)
}

console.log(`OS/OP confirmadas y activas: ${ventas.length}`)
console.log(`Con monto real: ${ventas.filter(v => num(v.total) > 0).length} | en cero: ${ventas.filter(v => num(v.total) === 0).length}`)

const porTipo = new Map()
for (const h of hallazgos) porTipo.set(h.tipo, (porTipo.get(h.tipo) ?? 0) + 1)
console.log('\n=== Hallazgos por tipo ===')
console.table([...porTipo].map(([tipo, n]) => ({ tipo, casos: n })))

console.log('\n=== Detalle ===')
for (const [tipo] of porTipo) {
  console.log(`\n· ${tipo}`)
  for (const h of hallazgos.filter(x => x.tipo === tipo)) console.log(`   #${h.id} ${h.alumno}: ${h.detalle}`)
}

await pool.end()
