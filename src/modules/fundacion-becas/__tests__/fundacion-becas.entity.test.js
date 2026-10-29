import { describe, it, expect } from 'vitest'
import {
  scholarshipEndDate, scholarshipStatus, assertCourseChoice, assertEditable, summarizeScholarships,
  normalizeScholarship, duplicateMessage, scholarshipAlerts
} from '../fundacion-becas.entity.js'

const HOY = '2026-10-27'

describe('scholarshipEndDate', () => {
  it('en vivo: el fin de la edicion manda', () => {
    expect(scholarshipEndDate({ edition_end_date: '2026-11-30', access_until: null })).toBe('2026-11-30')
  })
  it('online: el fin es access_until', () => {
    expect(scholarshipEndDate({ edition_end_date: null, access_until: '2027-01-15' })).toBe('2027-01-15')
  })
  it('online sin plazo: no tiene fin conocido', () => {
    expect(scholarshipEndDate({ edition_end_date: null, access_until: null })).toBeNull()
  })
})

describe('scholarshipStatus', () => {
  it('sin activar y con el curso por terminar: pendiente', () => {
    expect(scholarshipStatus({ activatedAt: null, endDate: '2026-11-30' }, HOY)).toBe('pending')
  })
  it('activada y con el curso en marcha: activa', () => {
    expect(scholarshipStatus({ activatedAt: '2026-10-01', endDate: '2026-11-30' }, HOY)).toBe('active')
  })
  it('activada y con el curso ya terminado: vencida', () => {
    expect(scholarshipStatus({ activatedAt: '2026-09-01', endDate: '2026-10-20' }, HOY)).toBe('expired')
  })
  it('online activada sin plazo: sigue activa', () => {
    expect(scholarshipStatus({ activatedAt: '2026-10-01', endDate: null }, HOY)).toBe('active')
  })
  it('el ultimo dia del curso aun es activa', () => {
    expect(scholarshipStatus({ activatedAt: '2026-10-01', endDate: HOY }, HOY)).toBe('active')
  })
  it('sin activar y con el curso terminado: vencida, no pendiente', () => {
    expect(scholarshipStatus({ activatedAt: null, endDate: '2026-10-20' }, HOY)).toBe('expired')
  })
})

describe('assertCourseChoice', () => {
  const online = { modality_alias: 'we_modality_online', edition_matches: false }
  const enVivo = { modality_alias: 'we_modality_live', edition_matches: true }

  it('online sin edicion pasa', () => expect(() => assertCourseChoice(online, null)).not.toThrow())
  it('online con edicion se rechaza', () => expect(() => assertCourseChoice(online, 10)).toThrow(/online/))
  it('en vivo sin edicion se rechaza', () => expect(() => assertCourseChoice(enVivo, null)).toThrow(/edición/))
  it('en vivo con edicion de otro curso se rechaza', () => {
    expect(() => assertCourseChoice({ ...enVivo, edition_matches: false }, 10)).toThrow(/no pertenece/)
  })
  it('curso inexistente se rechaza', () => expect(() => assertCourseChoice(null, null)).toThrow(/no existe/))
})

describe('summarizeScholarships', () => {
  it('cuenta por estado y por modalidad', () => {
    const rows = [
      { modality: 'En Vivo', activated_at: null, edition_end_date: '2026-11-30', access_until: null },
      { modality: 'En Vivo', activated_at: '2026-09-01', edition_end_date: '2026-10-20', access_until: null },
      { modality: 'Online', activated_at: '2026-10-01', edition_end_date: null, access_until: null }
    ]
    const r = summarizeScholarships({ today: HOY, rows })
    expect(r.kpis).toEqual({ total: 3, pending: 1, active: 1, expired: 1, converted: 0 })
    expect(r.byModality).toEqual([
      { modality: 'En Vivo', total: 2, pending: 1, active: 0, expired: 1 },
      { modality: 'Online', total: 1, pending: 0, active: 1, expired: 0 }
    ])
    expect(r.items[1].end_date).toBe('2026-10-20')
  })
})

describe('normalizeScholarship', () => {
  it('el DNI se compara sin espacios ni minusculas', () => {
    expect(normalizeScholarship({ document_number: ' ab123456 ', program_edition_id: 5 }))
      .toMatchObject({ document_number: 'AB123456', program_edition_id: 5 })
  })
  it('sin edicion (online) queda null, no 0 ni undefined', () => {
    expect(normalizeScholarship({ document_number: '12345678' }).program_edition_id).toBeNull()
  })
})

describe('duplicateMessage', () => {
  it('dice cual es la beca que ya existe', () => {
    expect(duplicateMessage({ scholarship_id: 7, partner_name: 'SEDIPRO UDEP' })).toMatch(/#7, SEDIPRO UDEP/)
  })
})

describe('conversion por aliado', () => {
  it('cuenta becarios que compraron otro curso y saca el %', () => {
    const base = { modality: 'Online', activated_at: null, edition_end_date: null, access_until: null }
    const rows = [
      { ...base, partner_name: 'SEDIPRO UDEP', purchases: 2 },
      { ...base, partner_name: 'SEDIPRO UDEP', purchases: 0 },
      { ...base, partner_name: 'SEDIPRO UDEP', purchases: 0 },
      { ...base, partner_name: 'Hult Prize', purchases: 1 }
    ]
    const r = summarizeScholarships({ today: HOY, rows })
    expect(r.kpis.converted).toBe(2)
    expect(r.byPartner).toEqual([
      { partner: 'SEDIPRO UDEP', total: 3, converted: 1, rate: 33 },
      { partner: 'Hult Prize', total: 1, converted: 1, rate: 100 }
    ])
  })
})

describe('scholarshipAlerts', () => {
  const ids = list => list.map(i => i.scholarship_id)
  it('pendiente con mas de 3 dias de registrada: avisa; con 3 o menos: no', () => {
    const items = [
      { scholarship_id: 1, status: 'pending', registration_date: '2026-10-23' },
      { scholarship_id: 2, status: 'pending', registration_date: '2026-10-24' },
      { scholarship_id: 3, status: 'active', registration_date: '2026-01-01', end_date: null }
    ]
    expect(ids(scholarshipAlerts(items, HOY).stalePending)).toEqual([1])
  })
  it('activa que termina en 7 dias o menos: avisa; online sin plazo y vencidas: no', () => {
    const items = [
      { scholarship_id: 1, status: 'active', end_date: '2026-11-03' },
      { scholarship_id: 2, status: 'active', end_date: '2026-11-04' },
      { scholarship_id: 3, status: 'active', end_date: null },
      { scholarship_id: 4, status: 'expired', end_date: '2026-10-26' },
      { scholarship_id: 5, status: 'active', end_date: HOY }
    ]
    expect(ids(scholarshipAlerts(items, HOY).expiringSoon)).toEqual([1, 5])
  })
})

describe('assertEditable', () => {
  const guardada = { program_id: 5, program_edition_id: 10, activated_at: null, edition_end_date: '2026-11-30', access_until: null }
  const activada = { ...guardada, activated_at: '2026-10-01' }
  const mismo = { program_id: 5, program_edition_id: 10 }

  it('sin activar: se puede cambiar el curso', () => {
    expect(() => assertEditable(guardada, { program_id: 6, program_edition_id: 20 }, HOY)).not.toThrow()
  })
  it('activada: corregir otros datos con el mismo curso pasa', () => {
    expect(() => assertEditable(activada, mismo, HOY)).not.toThrow()
  })
  it('activada: pasarse a otra edicion del mismo curso pasa (postergacion)', () => {
    expect(() => assertEditable(activada, { program_id: 5, program_edition_id: 11 }, HOY)).not.toThrow()
  })
  it('activada: cambiar a otro curso se rechaza', () => {
    expect(() => assertEditable(activada, { program_id: 6, program_edition_id: 20 }, HOY)).toThrow(/activada/)
  })
  it('vencida sin activar: solo lectura', () => {
    expect(() => assertEditable({ ...guardada, edition_end_date: '2026-10-03' }, mismo, HOY)).toThrow(/vencida/)
  })
  it('vencida y activada: solo lectura', () => {
    expect(() => assertEditable({ ...activada, edition_end_date: '2026-10-20' }, mismo, HOY)).toThrow(/vencida/)
  })
  it('el dia del fin aun se puede editar', () => {
    expect(() => assertEditable({ ...activada, edition_end_date: HOY }, mismo, HOY)).not.toThrow()
  })
})
