// Seguimiento al Alumno (Academica, pedido del usuario 26/10/26): por aula,
// cuantos alumnos aprobaron, desaprobaron o aun no tienen nota.

// Nota minima para aprobar y certificar. Se redondea ANTES de comparar
// (decision del usuario 26/10/26): 11.5 aprueba, 11.49 no.
// Ojo: el acta del aula (GRADE_RULES.PASS_THRESHOLD en edition.entity.js)
// compara sin redondear, asi que un 11.5 sale aprobado aqui y desaprobado alla.
// Es a proposito hasta que el area alinee las dos reglas.
export const PASS_GRADE = 12

// Sin nota cargada no es desaprobado: en un aula en curso todos lo estarian.
export function gradeStatus ({ hasGrade, finalGrade }) {
  if (!hasGrade || finalGrade === null || finalGrade === undefined) return 'no_grade'
  return Math.round(Number(finalGrade)) >= PASS_GRADE ? 'approved' : 'failed'
}

const emptyCounts = () => ({ students: 0, approved: 0, failed: 0, no_grade: 0 })

// Modalidad Flex (pedido del usuario 29/10/26): la marca vive en el ERP
// (enrollments.cat_inscription_modality); Odoo no la tiene, asi que a los
// alumnos de Odoo se les cruza por documento dentro de la misma aula.
export const docKey = (editionId, doc) => doc ? `${editionId}|${String(doc).trim()}` : null

export function flexDocKeys (erpRows) {
  return new Set(erpRows.filter(r => r.is_flex).map(r => docKey(r.edition_id, r.document_number)).filter(Boolean))
}

// Cruza las aulas con la nota de cada alumno y cuenta por estado. Las aulas sin
// alumnos no se listan: no hay a quien hacerle seguimiento. En flex van los
// mismos conteos, solo de los alumnos Flex del aula.
export function summarizeClassrooms (classrooms, gradeRows) {
  const byEdition = new Map()
  for (const r of gradeRows) {
    const counts = byEdition.get(r.edition_id) || { ...emptyCounts(), flex: emptyCounts() }
    const status = gradeStatus({ hasGrade: r.has_grade, finalGrade: r.final_grade })
    for (const c of r.is_flex ? [counts, counts.flex] : [counts]) {
      c.students++
      c[status]++
    }
    byEdition.set(r.edition_id, counts)
  }
  const items = classrooms
    .filter(c => byEdition.has(c.edition_id))
    .map(c => ({ ...c, ...byEdition.get(c.edition_id) }))
  const kpis = emptyCounts()
  for (const i of items) for (const k of Object.keys(kpis)) kpis[k] += i[k]
  return { items, kpis: { classrooms: items.length, ...kpis } }
}

// Promedio final de Odoo (slide.group.evaluation.final_score) rehecho con los
// campos guardados, porque leerlo para todas las aulas tarda minutos. Deducido
// el 26/10/26 contra 524 alumnos (1 no cuadra: 19/19/19 da 20 en Odoo): el
// sustitutorio reemplaza la nota mas baja, se promedia y se topa en 20.
// Odoo guarda 0 en las notas no cargadas: sin parcial, final ni sustitutorio
// el alumno va como "sin nota".
export function odooFinalScore ({ midterm_exam: mid, final_exam: fin, substitute_exam: sub }) {
  if (!mid && !fin && !sub) return null
  const [low, high] = [mid || 0, fin || 0].sort((a, b) => a - b)
  return Math.min(20, ((sub || low) + high) / 2)
}

// Filas de nota (mismo shape que listGradeRows) desde los inscritos de Odoo
// (studentScoresByGroup: uno por inscrito, con 0 en las notas no cargadas).
// flexKeys (flexDocKeys): un inscrito de Odoo es Flex si su documento esta
// como Flex en esa aula del ERP; si no cruza, va como regular.
export function odooGradeRows (editionToGroup, odooStudents, flexKeys = new Set()) {
  const byGroup = new Map()
  for (const e of odooStudents) {
    const gid = e.slide_group_id?.[0]
    if (!byGroup.has(gid)) byGroup.set(gid, [])
    const score = odooFinalScore(e)
    byGroup.get(gid).push({ final_grade: score, has_grade: score !== null, doc: e.document_number })
  }
  const rows = []
  for (const [editionId, gid] of editionToGroup) {
    for (const { doc, ...r } of byGroup.get(gid) || []) {
      rows.push({ edition_id: editionId, ...r, is_flex: flexKeys.has(docKey(editionId, doc)) })
    }
  }
  return rows
}

// Notas por aula: si el grupo de Odoo tiene inscritos, mandan los de Odoo
// (pedido del usuario 26/10/26); si no, quedan las del ERP.
export function mergeGradeRows (erpRows, odooRows) {
  const fromOdoo = new Set(odooRows.map(r => r.edition_id))
  return [...erpRows.filter(r => !fromOdoo.has(r.edition_id)), ...odooRows]
}

// Flujo del aula (pedido del usuario 26/10/26):
//  - initial: inscritos al inicio = los que siguen + los que se retiraron.
//  - completed: culminaron = terminaron con nota final (aprobado o desaprobado).
//    Solo en aulas finalizadas (fin < hoy, misma regla que aulaStatus del
//    front); en curso o proximas es null: aun no termina nadie.
// retiredByEdition: edicion -> { all, flex } (listRetiredCounts). Flex recibe
// el mismo flujo con sus propios conteos.
export function withEnrollmentFlow (items, retiredByEdition, today) {
  return items.map(i => {
    const retired = retiredByEdition.get(i.edition_id) || { all: 0, flex: 0 }
    const finished = Boolean(i.end_date) && String(i.end_date).slice(0, 10) < today
    const flow = (c, n) => ({ ...c, retired: n, initial: c.students + n, completed: finished ? c.approved + c.failed : null })
    return { ...flow(i, retired.all), flex: flow(i.flex, retired.flex) }
  })
}

export function withGradeStatus (students) {
  return students.map(s => ({
    ...s,
    final_grade: s.has_grade && s.final_grade !== null ? Number(s.final_grade) : null,
    status: gradeStatus({ hasGrade: s.has_grade, finalGrade: s.final_grade })
  }))
}

// Pisa los datos del aula con los de su grupo en Odoo (decision del usuario
// 26/10/26: el aula se ve como en Odoo; las notas siguen del ERP). Un campo
// vacio en Odoo deja el del ERP. El horario de Odoo ya trae dias y horas
// juntos ("7:00pm - 10:00pm | Lunes - Miercoles"), por eso reemplaza a los dos.
// "Especialista WE" es el contacto generico que Odoo publica en algunas aulas
// (16 al 26/10/26); el correo si es del docente real, el nombre no.
const GENERIC_TEACHER = /^especialista we$/i

export function withOdooData (classrooms, odooByEdition) {
  return classrooms.map(({ odoo_activation, ...c }) => {
    const o = odooByEdition.get(c.edition_id)
    if (!o) return { ...c, source: 'erp' }
    const pick = k => o[k] ?? c[k]
    return {
      ...c,
      course: pick('course'),
      instructor: GENERIC_TEACHER.test(o.instructor?.trim() ?? '') ? c.instructor : pick('instructor'),
      instructor_email: pick('instructor_email'),
      sessions: pick('sessions'),
      start_date: pick('start_date'),
      end_date: pick('end_date'),
      ...(o.schedule && { days: o.schedule, hours: null }),
      group_id: o.group_id,
      source: 'odoo'
    }
  })
}

// Modal del aula: los que siguen y, al final, los que salieron (retiro, RP o
// CC, ver listClassroomDepartures) para que se vean en rojo y cuadre con la
// columna Retirados. Sin nota: ya no estan en el aula.
export function withDepartures (students, departures) {
  return [
    ...students,
    ...departures.map(d => ({
      enrollment_id: `salida-${d.enrollment_id}`,
      full_name: d.full_name,
      document_number: d.document_number,
      email: d.email,
      final_grade: null,
      status: 'retired',
      reason: d.reason,
      is_flex: Boolean(d.is_flex)
    }))
  ]
}
