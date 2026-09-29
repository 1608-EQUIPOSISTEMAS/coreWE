import { describe, it, expect } from 'vitest'
import {
  lastMonths, weightedConversionGoal, toneVsGoal, leadPlanByChannel,
  repurchaseCohorts, salesProgress, buildCommercialReport, goalInPeriod, businessDaysBetween
} from '../commercial-report.entity.js'

describe('lastMonths', () => {
  it('cruza el año sin saltarse meses', () => {
    expect(lastMonths('2026-02', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
  })
})

describe('weightedConversionGoal', () => {
  it('pondera por la mezcla de consultas, no promedia las metas', () => {
    expect(weightedConversionGoal({ NEW: { consultas: 100 }, CWE: { consultas: 10 } })).toBe(15.6)
  })

  it('sin consultas no hay meta', () => {
    expect(weightedConversionGoal({})).toBeNull()
  })
})

describe('toneVsGoal', () => {
  it('sin meta o sin dato no pinta rojo', () => {
    expect(toneVsGoal(null, 15)).toBeNull()
    expect(toneVsGoal(40, null)).toBeNull()
    expect(toneVsGoal(14, 15)).toBe('warn')
    expect(toneVsGoal(10, 15)).toBe('bad')
  })
})

describe('leadPlanByChannel', () => {
  it('suma las consultas CANAL_MOMENTO de cada canal contra su plan', () => {
    const plan = leadPlanByChannel([
      { metas_canal: { MARKETING: { consultas: 100 } }, canales: { MARKETING_NUEVO: { consultas: 30 }, MARKETING_LEAD: { consultas: 20 }, OTROS_NUEVO: { consultas: 5 } } }
    ])
    const mkt = plan.canales.find((c) => c.canal === 'MARKETING')
    expect(mkt).toMatchObject({ meta: 100, consultas: 50, pct: 50, tono: 'ok' })
    // Un canal sin plan no tiene %: las consultas se muestran igual.
    expect(plan.canales.find((c) => c.canal === 'OTROS')).toMatchObject({ meta: 0, consultas: 5, pct: null })
  })
})

describe('repurchaseCohorts', () => {
  it('una cohorte se cierra a los 12 meses; un mes sin compras no es 0 %', () => {
    const [vieja, vacia] = repurchaseCohorts([{ mes: '2025-08', clientes: 50, recompraron: 10 }], ['2025-08', '2026-08'], '2026-09-28')
    expect(vieja).toMatchObject({ tasa: 20, cerrada: true, tono: 'ok' })
    expect(vacia).toMatchObject({ clientes: 0, tasa: null, cerrada: false, meses_transcurridos: 1, tono: null })
  })
})

describe('salesProgress', () => {
  it('un rango cerrado se juzga completo; sin meta no hay tono', () => {
    const period = { start: '2026-07-01', end: '2026-07-31' }
    expect(salesProgress({ logrado: 85, meta: 100, period, today: '2026-09-28' })).toMatchObject({ pct: 85, esperado: 100, tono: 'bad' })
    expect(salesProgress({ logrado: 90, meta: null, period, today: '2026-09-28' }).tono).toBeNull()
  })

  it('en curso exige solo los dias habiles transcurridos', () => {
    // 1-4 set 2026 = mar a vie (4 habiles) de 22 habiles del mes.
    const r = salesProgress({ logrado: 20, meta: 100, period: { start: '2026-09-01', end: '2026-09-30' }, today: '2026-09-04' })
    expect(r).toMatchObject({ esperado: 18, tono: 'ok' })
  })
})

describe('goalInPeriod', () => {
  it('prorratea la semana del plan que el rango corta', () => {
    const semanas = [{ date_start: '2026-09-01', date_end: '2026-09-07', meta: 70 }, { date_start: '2026-09-08', date_end: '2026-09-14', meta: 70 }]
    expect(goalInPeriod(semanas, { start: '2026-09-01', end: '2026-09-10' })).toBe(100)
    expect(goalInPeriod(semanas, { start: '2026-10-01', end: '2026-10-10' })).toBeNull()
  })

  it('cuenta lunes a viernes', () => {
    expect(businessDaysBetween('2026-09-26', '2026-09-28')).toBe(1) // sab, dom, lun
  })
})

describe('buildCommercialReport', () => {
  it('conversión con base chica queda sin tasa y la web se cuenta aparte de los tipos', () => {
    const r = buildCommercialReport({
      period: { start: '2026-07-01', end: '2026-07-31' },
      today: '2026-09-28',
      ventas: [],
      planWeeks: [],
      cohortes: [],
      ediciones: [],
      blackPorVencer: [],
      conversion: [
        { dia: '2026-07-03', tipo: 'NEW', web: true, consultas: 100, ventas: 10 },
        { dia: '2026-07-04', tipo: 'CWE', web: false, consultas: 10, ventas: 4 },
        { dia: '2026-07-05', tipo: null, web: true, consultas: 20, ventas: 20 },
        { dia: '2026-08-01', tipo: 'NEW', web: false, consultas: 500, ventas: 0 } // fuera del rango
      ]
    })
    expect(r.conversion.NEW.tasa).toBe(10)
    expect(r.conversion.CWE.tasa).toBeNull() // 10 consultas: base insuficiente
    expect(r.conversion.WEB).toMatchObject({ consultas: 120, ventas: 30, tasa: 25 })
    expect(r.conversion.PONDERADA).toMatchObject({ consultas: 110, ventas: 14, meta: 15.6 })
    expect(r.meses).toHaveLength(6)
  })
})
