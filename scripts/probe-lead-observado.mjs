// Datos crudos del lead observado y su inscripcion: sirve para saber si el modal
// se abre vacio porque la BD no tiene el dato o porque el frontend no lo pide.
import { q, pool } from './db.mjs'

const leadId = Number(process.argv[2] || 430165)

const { rows: [lead] } = await q(
  `SELECT * FROM leads WHERE lead_id = $1`, [leadId]
)
console.log('lead:', lead ?? 'no existe')

if (lead?.enrollment_id) {
  const { rows: [e] } = await q(
    `SELECT * FROM enrollments WHERE enrollment_id = $1`, [lead.enrollment_id]
  )
  console.log('enrollment:', e)
}

await pool.end()
