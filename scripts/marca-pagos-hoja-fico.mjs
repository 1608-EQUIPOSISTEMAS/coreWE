// Fase 2 de la importación FICO: marcar como COBRADO lo que la hoja ya da por
// cobrado. El SP de alta crea el cronograma en pendiente y no registra ningún
// `payments`, así que sin este paso una venta "Saldado" aparece con deuda.
//
// Regla (confirmada por el usuario, 2026-07-24): la columna INGRESO es lo
// efectivamente cobrado. Se recorren las cuotas en orden (inicial primero) y se
// marcan pagadas mientras el acumulado quepa dentro de INGRESO. Una cuota que no
// entra completa NO se marca: media cuota pagada no existe en el modelo.
//
// Uso (desde Backend/):
//   node scripts/marca-pagos-hoja-fico.mjs scripts/_hoja_xxx.csv           (dry-run)
//   node scripts/marca-pagos-hoja-fico.mjs scripts/_hoja_xxx.csv --aplicar
//
// Es idempotente: solo toca cuotas en pendiente y solo inserta el `payments` de
// una cuota que no lo tenga.
import { readFile } from 'node:fs/promises'
import { q, pool } from './db.mjs'

const csv = process.argv[2]
const aplicar = process.argv.includes('--aplicar')
if (!csv) { console.error('Falta el CSV congelado de la hoja.'); process.exit(1) }

const PENDIENTE = 2470
const PAGADA = 4454
const RESERVA = 2471 // estado con que el SP deja la inicial/contado
const BORRADOR = 3174 // cuotas de tandas viejas: otro modelo, no se tocan
const TIPO_PAGO = 3115 // we_payment_type_single
const LIQUIDACION_PENDIENTE = 2573
const USER_ID = 9 // ADMIN, el mismo de la importación

await import('../src/buildApp.js') // cablea los puertos del importer
const { loadWorkbook } = await import('../src/modules/importer/importer.sources.js')
const { validateFile } = await import('../src/modules/importer/importer.usecases.js')

// Se reusa la resolución del importador para tener, por fila, la edición y los
// datos de pago ya traducidos a IDs (medio, cuenta bancaria, fecha, operación).
const wb = await loadWorkbook(await readFile(csv), 'csv')
const { results } = await validateFile('enrollment_fico', Buffer.from(await wb.xlsx.writeBuffer()))

let tocadas = 0; let pagos = 0
for (const r of results) {
  if (r.status !== 'valid' || !r.data) continue
  const { raw, data } = r
  const cobrado = Number(raw.ingreso) || 0
  if (cobrado <= 0) continue

  // La inscripción de esta fila: misma persona, misma edición (o sin edición en
  // las convalidaciones E0) y creada por la importación masiva.
  const { rows: enr } = await q(`
    SELECT e.enrollment_id, e.total_amount
      FROM public.enrollments e
      JOIN public.customers c ON c.customer_id = e.customer_id
      JOIN public.persons p ON p.person_id = c.person_id
     WHERE p.document_number = $1
       AND e.parent_enrollment_id IS NULL
       AND e.program_version_id = $2
       AND e.program_edition_id IS NOT DISTINCT FROM $3
       AND COALESCE(e.notes, '') LIKE '%masiva FICO%'
     ORDER BY e.enrollment_id DESC LIMIT 1`,
  [data.document_number, data.program_version_id, data.program_edition_id ?? null])

  if (!enr.length) { console.log(`fila ${r.rowNumber}: sin inscripción importada (${raw.full_name}) - se omite`); continue }
  const enrollmentId = enr[0].enrollment_id

  const { rows: cuotas } = await q(`
    SELECT pi.installment_id, pi.installment_number AS n, pi.amount, pi.due_date, pi.cat_status,
           EXISTS (SELECT 1 FROM public.payments pg WHERE pg.installment_id = pi.installment_id AND pg.active = 'Y') AS tiene_pago
      FROM public.payment_installments pi
     WHERE pi.enrollment_id = $1
     ORDER BY pi.installment_number`, [enrollmentId])

  // Cronograma en Borrador (3174) = inscripción de una tanda vieja, con otro
  // modelo de cobranza (sus pagos reales ya están registrados aparte). No se
  // toca: reconciliarla contra la hoja es una decisión, no un automatismo.
  if (cuotas.some(c => Number(c.cat_status) === BORRADOR)) {
    console.log(`fila ${r.rowNumber}: ${raw.full_name} -> enr ${enrollmentId} | cronograma en BORRADOR, se omite (revisar a mano)`)
    continue
  }

  let acumulado = 0
  const marcar = []
  for (const c of cuotas) {
    const monto = Number(c.amount)
    if (acumulado + monto > cobrado + 0.01) break // esta cuota aún no está cubierta
    acumulado += monto
    marcar.push(c)
  }

  const detalle = marcar.map(c => `#${c.n}:${c.amount}`).join(' ')
  console.log(`fila ${r.rowNumber}: ${raw.full_name} -> enr ${enrollmentId} | total ${enr[0].total_amount} | cobrado hoja ${cobrado} | cubre ${acumulado} [${detalle}]`)

  if (!aplicar) continue

  for (const c of marcar) {
    if (Number(c.cat_status) === PENDIENTE) {
      await q('UPDATE public.payment_installments SET cat_status = $1 WHERE installment_id = $2', [PAGADA, c.installment_id])
      tocadas++
    }
    if (!c.tiene_pago) {
      // La operación bancaria de la hoja es una sola y corresponde al primer
      // cobro; las cuotas siguientes se registran sin código de operación.
      await q(`
        INSERT INTO public.payments (enrollment_id, installment_id, amount, payment_date, transaction_code,
                                     cat_method_payment, cat_payment_type, cat_settlement_status,
                                     settled_in_account_id, active, user_registration_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Y', $10)`,
      [enrollmentId, c.installment_id, c.amount, c.due_date,
        Number(c.n) === 0 || cuotas.length === 1 ? (data.transaction_code || null) : null,
        data.cat_payment_medium || null, TIPO_PAGO, LIQUIDACION_PENDIENTE,
        data.bank_account_id || null, USER_ID])
      pagos++
    }
  }
}

if (aplicar) {
  console.log(`\ncuotas pasadas a pagada: ${tocadas} | pagos creados: ${pagos}`)
  await q('REFRESH MATERIALIZED VIEW public.mv_enrollment_report_system')
  console.log('matview refrescada')
} else {
  console.log('\n(dry-run: nada escrito; agrega --aplicar)')
}

await pool.end()
process.exit(0)
