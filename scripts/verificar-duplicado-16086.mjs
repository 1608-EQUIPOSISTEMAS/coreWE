// Verifica contra produccion que el guard de duplicados ya no bloquea el
// reingreso a POWER APPS E10-26 (ed 15070) del socio WE GOLD 70120821, cuya
// venta original (16086) quedo en CC al financiar el upgrade.
import { pool, q } from './db.mjs'
import { EnrollmentRepository } from '../src/modules/fico/enrollment/enrollment.repository.js'

const repo = new EnrollmentRepository({ query: (t, p) => q(t, p) })

console.log('duplicado en E10-26 (deberia ser null):',
  await repo.findDuplicate({ programEditionId: 15070, doc: '70120821', mail: 'yardelcondoricisneros@gmail.com' }))

// Control: un alumno realmente activo en esa edicion SI debe seguir bloqueando.
const { rows: [vivo] } = await q(`
  SELECT per.document_number AS doc
    FROM enrollments e
    JOIN customers cu ON cu.customer_id = e.customer_id
    JOIN persons per ON per.person_id = cu.person_id
    JOIN catalog cts ON cts.catalog_id = e.cat_type_status
   WHERE e.program_edition_id = 15070 AND e.active='Y'
     AND cts.description NOT IN ('CC','RP','R','Anulado')
     AND per.document_number IS NOT NULL LIMIT 1`)
console.log('control alumno activo', vivo?.doc, '->',
  (await repo.findDuplicate({ programEditionId: 15070, doc: vivo?.doc, mail: null }))?.enrollment_id ?? null)
await pool.end()
