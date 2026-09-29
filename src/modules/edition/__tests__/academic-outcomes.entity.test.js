import { describe, it, expect } from 'vitest'
import {
  hasFinalGrade, classifyStudentOutcome, buildAcademicOutcomes, todayInLima, MIN_EVALUATED_FOR_RATE
} from '../academic-outcomes.entity.js'

// graded_at se fija la primera vez que esto da true: si un bloque en ceros
// contara como nota, el aula recién abierta caería como cargada.
describe('hasFinalGrade', () => {
  it('no cuenta el bloque vacío ni el bloque en ceros', () => {
    expect(hasFinalGrade({})).toBe(false)
    expect(hasFinalGrade(null)).toBe(false)
    expect(hasFinalGrade({ 1: 0, 2: 0, 3: 0, 4: 0 })).toBe(false)
  })

  it('cuenta en cuanto hay un criterio calificado', () => {
    expect(hasFinalGrade({ 1: 0, 2: 14, 3: 0, 4: 0 })).toBe(true)
  })
})

describe('todayInLima', () => {
  it('a las 23:30 de Lima (04:30 UTC del día siguiente) sigue siendo hoy en Lima', () => {
    expect(todayInLima(new Date('2026-09-29T04:30:00Z'))).toBe('2026-09-28')
  })
})

// Regla de Académica: en clase nadie jala; cerrada el aula, cero o sin final = jalado.
describe('classifyStudentOutcome', () => {
  const HOY = '2026-09-28'
  const base = { aulaEnd: '2026-09-01', aulaHasGrades: true, graded: true, finalGrade: 12 }

  it('mientras el aula dicta (incluido su último día) no hay jalados', () => {
    expect(classifyStudentOutcome({ ...base, aulaEnd: HOY, finalGrade: 5 }, HOY)).toBe('EN_CURSO')
  })

  it('12 aprueba, 11.99 jala', () => {
    expect(classifyStudentOutcome(base, HOY)).toBe('APROBADO')
    expect(classifyStudentOutcome({ ...base, finalGrade: 11.99 }, HOY)).toBe('JALADO')
  })

  it('sin entregable final en aula cerrada: pendiente dentro del plazo de carga, jalado después', () => {
    const sinFinal = { ...base, graded: false, finalGrade: 14 }
    expect(classifyStudentOutcome({ ...sinFinal, aulaEnd: '2026-09-23' }, HOY)).toBe('PENDIENTE')
    expect(classifyStudentOutcome({ ...sinFinal, aulaEnd: '2026-09-20' }, HOY)).toBe('JALADO')
  })

  it('un aula sin ninguna nota cargada no jala a sus alumnos', () => {
    expect(classifyStudentOutcome({ ...base, aulaHasGrades: false, graded: false }, HOY)).toBe('SIN_REGISTRO')
  })
})

describe('buildAcademicOutcomes', () => {
  const HOY = '2026-09-28'
  const aprobado = { aulaEnd: '2026-08-20', aulaHasGrades: true, graded: true, gradedOn: '2026-09-05', finalGrade: 16, certified: false, certOn: null }

  it('cuenta el resultado en el mes de carga de la nota y el jalado sin final al vencer el plazo', () => {
    const { meses } = buildAcademicOutcomes({
      alumnos: [aprobado, { ...aprobado, graded: false, gradedOn: null, finalGrade: 0 }]
    }, HOY)
    const sep = meses.find((m) => m.mes === '2026-09')
    const ago = meses.find((m) => m.mes === '2026-08')
    expect(sep).toMatchObject({ aprobados: 1, jalados: 0, notas_finales: 1 })
    expect(ago).toMatchObject({ jalados: 1, sin_final: 1 }) // 20/08 + 8 días = 28/08
  })

  it('la ventana trae los 6 meses aunque estén vacíos, del más reciente al más antiguo', () => {
    const { meses } = buildAcademicOutcomes({ alumnos: [] }, HOY)
    expect(meses.map((m) => m.mes)).toEqual(['2026-09', '2026-08', '2026-07', '2026-06', '2026-05', '2026-04'])
  })

  it(`con menos de ${MIN_EVALUATED_FOR_RATE} evaluados no muestra tasa`, () => {
    const pocos = Array.from({ length: MIN_EVALUATED_FOR_RATE - 1 }, () => aprobado)
    const { meses: [sep], tarjetas } = buildAcademicOutcomes({ alumnos: pocos }, HOY)
    expect(sep).toMatchObject({ base_insuficiente: true, tasa_aprobacion: null })
    expect(tarjetas.find((t) => t.label === 'Tasa de aprobación').comparativo).toMatch(/Base insuficiente/)

    const { meses: [sepLleno] } = buildAcademicOutcomes({ alumnos: [...pocos, { ...aprobado, finalGrade: 8 }] }, HOY)
    expect(sepLleno.tasa_aprobacion).toBe(96.7)
  })

  it('aprobados sin certificado dicen cuánto espera el más antiguo', () => {
    const { tarjetas } = buildAcademicOutcomes({
      alumnos: [aprobado, { ...aprobado, certified: true, certOn: '2026-09-10' }]
    }, HOY)
    expect(tarjetas.find((t) => t.label === 'Aprobados sin certificado'))
      .toMatchObject({ valor: 1, espera_max_dias: 23, comparativo: 'El más antiguo espera 23 días' })
    expect(tarjetas.find((t) => t.label === 'Certificados emitidos').valor).toBe(1)
  })

  // El reporte arma su veredicto buscando tarjetas por clave: renombrar un
  // label no puede dejarlo sin datos.
  it('cada tarjeta lleva una clave estable', () => {
    const { tarjetas } = buildAcademicOutcomes({ alumnos: [] }, HOY)
    expect(tarjetas.map((t) => t.clave))
      .toEqual(['aprobados', 'jalados', 'tasa_aprobacion', 'certificados', 'sin_certificado'])
    expect(tarjetas.find((t) => t.clave === 'sin_certificado').espera_max_dias).toBeNull()
  })

  it('lista primero a los que más esperan su certificado (máx. 5)', () => {
    const alumnos = [3, 40, 10, 25, 60, 7].map((d, i) => ({
      ...aprobado, alumno: `A${i}`, aula: 'BI E1', gradedOn: '2026-01-01', aulaEnd: '2026-09-01'
    }))
    // la espera corre desde la carga o el cierre, lo que sea más tarde: aquí el cierre (27 días)
    const { esperando_certificado: lista } = buildAcademicOutcomes({ alumnos }, HOY)
    expect(lista).toHaveLength(5)
    expect(lista[0]).toMatchObject({ alumno: 'A0', aula: 'BI E1', dias: 27 })
  })
})

describe('objetivo de certificación', () => {
  const HOY = '2026-09-28'
  const alumno = (programa, certified, finalGrade = 16) => ({
    aulaEnd: '2026-08-20', aulaHasGrades: true, graded: true, gradedOn: '2026-09-05',
    finalGrade, certified, certOn: certified ? '2026-09-10' : null, programa
  })

  it('la tasa es certificados sobre todos los que terminaron, jalados incluidos', () => {
    const alumnos = [alumno('BI', true), alumno('BI', true), alumno('BI', false), alumno('BI', false, 8)]
    const { objetivo_certificacion: o } = buildAcademicOutcomes({ alumnos }, HOY)
    expect(o).toMatchObject({ meta: 85, evaluados: 4, certificados: 2, tasa: 50, faltan: 2 })
  })

  it('rankea solo programas con base suficiente y bajo la meta', () => {
    const alumnos = [
      ...Array.from({ length: 10 }, (_, i) => alumno('SAP', i < 3)),
      ...Array.from({ length: 10 }, () => alumno('EXCEL', true)),
      alumno('CHICO', false)
    ]
    const { objetivo_certificacion: o } = buildAcademicOutcomes({ alumnos }, HOY)
    expect(o.programas_bajos).toEqual([{ programa: 'SAP', evaluados: 10, certificados: 3, tasa: 30 }])
  })
})
