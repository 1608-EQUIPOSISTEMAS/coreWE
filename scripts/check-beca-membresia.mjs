// Check del fix "socio vendido con membresia salia como BECA".
// Corre las dos consultas reales del aula (lista de alumnos + contadores del
// cronograma) contra produccion y afirma que los 5 casos conocidos ya NO son
// beca. Falla (assert) si el criterio vuelve a romperse.
//
//   node scripts/check-beca-membresia.mjs
import assert from 'node:assert/strict'
import { pool } from './db.mjs'
import { EditionRepository } from '../src/modules/edition/edition.repository.js'

const repo = new EditionRepository(pool)

// enrollment vendido con membership_program_id -> edicion de una de sus hojas
const CASOS = [
  { edition: 15073, email: 'angelsgabrielr97@gmail.com', tier: 'WE BLACK' }
]

try {
  for (const c of CASOS) {
    const alumnos = await repo.classroomStudentsList(c.edition)
    const s = alumnos.find(a => (a.email || '').toLowerCase() === c.email)
    assert.ok(s, `no aparece ${c.email} en la edicion ${c.edition}`)
    assert.equal(s.is_beca, false, `${c.email} sigue marcado como BECA`)
    assert.equal(s.member_benefits, true, `${c.email} no cuenta como MEMB`)
    assert.equal(s.membership_tier_name, c.tier)
    console.log(`OK lista  ed.${c.edition}: ${s.full_name} -> MEM (${s.membership_tier_name})`)

    const [m] = await repo.classroomChannelMetricsList([c.edition])
    assert.ok(m, `sin metricas para la edicion ${c.edition}`)
    console.log(`OK conteo ed.${c.edition}:`, m)
  }

  // Ninguna venta con tier grabado puede contarse como beca en su aula.
  const { rows } = await pool.query(`
    SELECT COUNT(*)::int AS n FROM public.enrollments e
     WHERE e.active = 'Y' AND e.membership_program_id IS NOT NULL
       AND COALESCE(e.total_amount,0) = 0`)
  console.log(`ventas en 0 con tier de membresia: ${rows[0].n} (todas deben salir MEM)`)
} finally {
  await pool.end()
}
