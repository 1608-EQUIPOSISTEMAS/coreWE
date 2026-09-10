// Verifica que getEnrollmentFlags devuelva TODO lo que el modal de subsanacion
// necesita repintar: sin esto el reenvio guarda la venta en blanco.
import 'dotenv/config'
import { pool } from './db.mjs'
import { EnrollmentRepository } from '../src/modules/fico/enrollment/enrollment.repository.js'

const enrollmentId = Number(process.argv[2] || 0)
const repo = new EnrollmentRepository(pool)

const { rows: [e] } = await pool.query(
  enrollmentId
    ? 'SELECT $1::int AS enrollment_id'
    : `SELECT l.enrollment_id FROM leads l JOIN enrollments en ON en.enrollment_id=l.enrollment_id
       JOIN catalog c ON c.catalog_id=en.cat_fico_status
       WHERE c.alias='we_enrollment_status_observed' LIMIT 1`,
  enrollmentId ? [enrollmentId] : []
)

const flags = await repo.getEnrollmentFlags(e.enrollment_id)
console.log(`inscripcion ${e.enrollment_id}:`)
console.log(flags)

const OBLIGATORIOS = ['document_number', 'cat_type_document', 'list_price', 'total_amount',
  'cat_currency', 'cat_payment_plan', 'cat_certificate_status', 'cat_inscription_modality']
const faltan = OBLIGATORIOS.filter(k => flags?.[k] === undefined)
console.log(faltan.length ? `FALTAN: ${faltan.join(', ')}` : 'OK: la consulta trae todos los campos del formulario')

await pool.end()
process.exit(faltan.length ? 1 : 0)
