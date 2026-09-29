import { GRADE_RULES } from './edition.entity.js'

// Resultados del alumno para el Reporte Académico: "¿cuántos aprueban, cuántos
// jalan, cuántos salen certificados?", mes a mes.

// Plazo que tiene el docente para cargar la nota final tras el cierre del aula.
export const GRADE_LOAD_SLA_DAYS = 7
// Con menos evaluados que esto, una tasa de aprobación no dice nada.
export const MIN_EVALUATED_FOR_RATE = 30
export const WINDOW_MONTHS = 6
// Objetivo del área (plan 2026): el 85 % de los estudiantes se certifica.
export const CERTIFICATION_GOAL_PCT = 85
// Con menos evaluados, un programa no entra al ranking: 1 de 2 no es una tasa.
export const MIN_EVALUATED_PER_PROGRAM = 10

// Hoy en Lima (UTC-5 fijo: Perú no tiene horario de verano). toISOString() a
// secas daría mañana después de las 19:00 de Lima.
export const todayInLima = (now = new Date()) => new Date(now.getTime() - 5 * 3_600_000).toISOString().slice(0, 10)

// La nota final cuenta como cargada cuando el docente calificó al menos un
// criterio del entregable final. Un bloque todo en 0 es el que se abre vacío:
// ese alumno se resuelve por el cierre del aula (classifyStudentOutcome).
export function hasFinalGrade (finalCriteria) {
  return Object.values(finalCriteria || {}).some((v) => Number(v) > 0)
}

const DAY_MS = 86_400_000
const toUtc = (ymd) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10))
export const daysBetween = (fromYmd, toYmd) => Math.round((toUtc(toYmd) - toUtc(fromYmd)) / DAY_MS)
const addDays = (ymd, n) => new Date(toUtc(ymd) + n * DAY_MS).toISOString().slice(0, 10)

// Regla del negocio (Académica, 28/09/26): mientras el aula dicta nadie está
// jalado. Cerrada el aula, el alumno sin entregable final (o con todo en cero)
// cuenta como jalado, pero recién vencido el plazo de carga del docente: antes
// es una nota pendiente, no un resultado. Un aula sin NINGUNA nota cargada es
// falla de registro, no del alumno: no suma jalados (va a "aulas sin nota").
export function classifyStudentOutcome ({ aulaEnd, aulaHasGrades, graded, finalGrade }, today) {
  const diasCerrada = daysBetween(aulaEnd, today)
  if (diasCerrada < 1) return 'EN_CURSO'
  if (!aulaHasGrades) return 'SIN_REGISTRO'
  if (graded) return Number(finalGrade) >= GRADE_RULES.PASS_THRESHOLD ? 'APROBADO' : 'JALADO'
  return diasCerrada > GRADE_LOAD_SLA_DAYS ? 'JALADO' : 'PENDIENTE'
}

// Mes en que el resultado quedó firme: el de carga de la nota (decisión del
// usuario), salvo que se haya cargado antes del cierre, en cuyo caso cuenta al
// cerrar. El jalado sin final queda firme al vencer el plazo de carga.
function outcomeMonth ({ aulaEnd, graded, gradedOn }) {
  const firme = graded
    ? (gradedOn > aulaEnd ? gradedOn : addDays(aulaEnd, 1))
    : addDays(aulaEnd, GRADE_LOAD_SLA_DAYS + 1)
  return firme.slice(0, 7)
}

function lastMonths (today, n) {
  const y = +today.slice(0, 4)
  const m = +today.slice(5, 7) - 1
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - i, 1)).toISOString().slice(0, 7))
}

const percentOf = (part, total) => (total ? Math.round((part / total) * 1000) / 10 : null)

// `alumnos`: una fila por alumno del roster de aulas ya terminadas (ver
// repository.academicOutcomeStudents). La clasificación vive aquí, no en SQL.
export function buildAcademicOutcomes ({ alumnos = [] }, today) {
  const meses = new Map(lastMonths(today, WINDOW_MONTHS).map((mes) => [mes, {
    mes, notas_finales: 0, aprobados: 0, jalados: 0, sin_final: 0, certificados: 0, certificados_cohorte: 0, suma: 0
  }]))
  const esperando = []
  const programas = new Map()

  for (const a of alumnos) {
    if (a.certOn) {
      const m = meses.get(a.certOn.slice(0, 7))
      if (m) m.certificados++
    }
    const resultado = classifyStudentOutcome(a, today)
    if (resultado !== 'APROBADO' && resultado !== 'JALADO') continue

    const m = meses.get(outcomeMonth(a))
    if (m) {
      if (a.graded) { m.notas_finales++; m.suma += Number(a.finalGrade) } else m.sin_final++
      if (resultado === 'APROBADO') m.aprobados++; else m.jalados++
      // Cohorte: de los que terminaron ese mes, cuántos tienen certificado hoy.
      // Es la tasa del objetivo; "certificados" (arriba) es el volumen emitido.
      if (a.certified) m.certificados_cohorte++
      const p = programas.get(a.programa) ?? { programa: a.programa, evaluados: 0, certificados: 0 }
      p.evaluados++
      if (a.certified) p.certificados++
      programas.set(a.programa, p)
    }
    if (resultado === 'APROBADO' && !a.certified) {
      const dias = daysBetween(a.gradedOn > a.aulaEnd ? a.gradedOn : a.aulaEnd, today)
      esperando.push({ alumno: a.alumno ?? null, aula: a.aula ?? null, dias })
    }
  }

  const serie = [...meses.values()].map(({ suma, ...m }) => {
    const evaluados = m.aprobados + m.jalados
    const baseInsuficiente = evaluados < MIN_EVALUATED_FOR_RATE
    return {
      ...m,
      evaluados,
      base_insuficiente: baseInsuficiente,
      tasa_aprobacion: baseInsuficiente ? null : percentOf(m.aprobados, evaluados),
      tasa_certificacion: baseInsuficiente ? null : percentOf(m.certificados_cohorte, evaluados),
      promedio: m.notas_finales ? Math.round((suma / m.notas_finales) * 100) / 100 : null
    }
  })
  const [actual, anterior] = serie
  esperando.sort((x, y) => y.dias - x.dias)
  const sinCertificado = esperando.length
  const esperaMasLarga = esperando[0]?.dias ?? null

  // `clave` es el contrato con el Frontend (veredicto y KPIs del reporte): el
  // `label` es texto de pantalla y puede cambiar sin romper a quien lo consume.
  return {
    meses: serie,
    objetivo_certificacion: certificationObjective(serie, [...programas.values()]),
    // Los que más esperan su certificado: la lista para actuar.
    esperando_certificado: esperando.slice(0, 5),
    tarjetas: [
      card('aprobados', 'Aprobados del mes', actual.aprobados, anterior.aprobados, 'num', 'fa-user-check'),
      card('jalados', 'Jalados del mes', actual.jalados, anterior.jalados, 'num', 'fa-user-xmark'),
      {
        ...card('tasa_aprobacion', 'Tasa de aprobación', actual.tasa_aprobacion, anterior.tasa_aprobacion, 'pct', 'fa-percent'),
        ...(actual.base_insuficiente && { comparativo: `Base insuficiente: ${actual.evaluados} evaluados (mín. ${MIN_EVALUATED_FOR_RATE})` })
      },
      card('certificados', 'Certificados emitidos', actual.certificados, anterior.certificados, 'num', 'fa-award'),
      {
        clave: 'sin_certificado',
        label: 'Aprobados sin certificado',
        valor: sinCertificado,
        unidad: 'num',
        icono: 'fa-hourglass-half',
        espera_max_dias: esperaMasLarga,
        comparativo: esperaMasLarga == null ? 'Nadie esperando' : `El más antiguo espera ${esperaMasLarga} días`
      }
    ]
  }
}

function card (clave, label, valor, previo, unidad, icono) {
  return { clave, label, valor, unidad, icono, previo: previo ?? null }
}

// Objetivo "85 % se certifica" sobre la ventana completa (6 meses): mes a mes
// la base es chica y la tasa salta. Base = alumnos con resultado firme
// (aprobados + jalados, incluido el que no entregó): el que jaló también es un
// estudiante que no se certificó.
export function certificationObjective (serie, programas) {
  const evaluados = serie.reduce((n, m) => n + m.evaluados, 0)
  const certificados = serie.reduce((n, m) => n + m.certificados_cohorte, 0)
  const tasa = percentOf(certificados, evaluados)
  return {
    meta: CERTIFICATION_GOAL_PCT,
    evaluados,
    certificados,
    tasa,
    // Cuántos certificados más hacían falta para llegar a la meta.
    faltan: tasa == null ? null : Math.max(0, Math.ceil((CERTIFICATION_GOAL_PCT / 100) * evaluados) - certificados),
    programas_bajos: programas
      .filter((p) => p.evaluados >= MIN_EVALUATED_PER_PROGRAM)
      .map((p) => ({ ...p, tasa: percentOf(p.certificados, p.evaluados) }))
      .filter((p) => p.tasa < CERTIFICATION_GOAL_PCT)
      .sort((a, b) => a.tasa - b.tasa)
      .slice(0, 5)
  }
}
