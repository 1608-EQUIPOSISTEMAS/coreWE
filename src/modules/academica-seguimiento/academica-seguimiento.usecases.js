import { summarizeClassrooms, withGradeStatus, withOdooData, odooGradeRows, mergeGradeRows, odooFinalScore, withEnrollmentFlow, withDepartures } from './academica-seguimiento.entity.js'
import { listClassrooms, listGradeRows, listClassroomStudents, getClassroomOdooKey, listRetiredCounts, listClassroomDepartures } from './academica-seguimiento.repository.js'
import { odoo } from '../../shared/adapters/odoo/odoo.adapter.js'

const hasOdooKey = c => c?.odoo_activation?.trim() && c.start_date

// Si Odoo no responde, la pantalla sigue con los datos del ERP.
const orErp = fallback => err => {
  console.warn(`[academica-seguimiento] Odoo no respondio, uso los datos del ERP: ${err.message}`)
  return fallback
}

// Datos del aula y notas: mandan los del grupo de Odoo (pedido del usuario
// 26/10/26). El universo de aulas sigue siendo el del ERP.
export async function listClassroomSummary () {
  const [classrooms, erpGradeRows, retired] = await Promise.all([listClassrooms(), listGradeRows(), listRetiredCounts()])
  const odooData = await odoo.classroomsFromOdoo(classrooms.filter(hasOdooKey)).catch(orErp(new Map()))
  const editionToGroup = new Map([...odooData].map(([id, o]) => [id, o.group_id]))
  const odooStudents = await odoo.studentScoresByGroup([...new Set(editionToGroup.values())]).catch(orErp([]))
  const gradeRows = mergeGradeRows(erpGradeRows, odooGradeRows(editionToGroup, odooStudents))
  const { items, kpis } = summarizeClassrooms(withOdooData(classrooms, odooData), gradeRows)
  // Hoy en Lima: la regla de 'finalizada' es la misma que la del front.
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' })
  return { items: withEnrollmentFlow(items, retired, today), kpis }
}

// Modal del aula: los que siguen y, al final, los que salieron (en rojo).
export async function listStudents (editionId) {
  const [current, departures] = await Promise.all([listCurrentStudents(editionId), listClassroomDepartures(editionId)])
  return withDepartures(current, departures)
}

// Los que siguen: los del grupo de Odoo con su promedio real (final_score); si
// el grupo no existe o no tiene alumnos, los del ERP (misma regla que
// mergeGradeRows, para que el modal cuadre con la fila).
async function listCurrentStudents (editionId) {
  const key = await getClassroomOdooKey(editionId)
  if (hasOdooKey(key)) {
    const group = (await odoo.classroomsFromOdoo([key]).catch(orErp(new Map()))).get(editionId)
    const students = group ? await odoo.groupStudents(group.group_id).catch(orErp([])) : []
    if (students.length) {
      return withGradeStatus(students.map(s => ({
        enrollment_id: `odoo-${s.id}`,
        full_name: s.full_name,
        document_number: s.document_number,
        email: s.email,
        final_grade: s.final_score,
        has_grade: odooFinalScore(s) !== null
      })))
    }
  }
  return withGradeStatus(await listClassroomStudents(editionId))
}
