import { describe, it, expect } from 'vitest'
import { purchaseOutlook, RETURNING_CLIENT_PROBABILITY, COLD_PROSPECT_PROBABILITY } from '../outlook.entity.js'
import { rankCandidates } from '../bandeja.entity.js'

const lead = (program_id, event_date) => ({ event_type: 'CONSULTA', source: 'ERP_LEAD', program_id, event_date })
const legacyBuy = (program_id, event_date) => ({ event_type: 'COMPRA', source: 'LEGACY_ALUMNO', program_id, event_date })
const erpBuy = (program_id, event_date) => ({ event_type: 'COMPRA', source: 'ERP_ENROLLMENT', program_id, event_date })

describe('purchaseOutlook', () => {
  // El caso del 15/10/26: la bandeja decia 9% y la ficha nada.
  const villa = [lead(88, '2026-08-17'), lead(88, '2026-01-27'), legacyBuy(27, '2025-12-29')]

  it('cliente que volvio a consultar 2 veces hace 59 dias: 9%, igual que la bandeja', () => {
    const o = purchaseOutlook(villa, '2026-10-15')
    expect(o).toMatchObject({ segment: 'VOLVIO', probability: RETURNING_CLIENT_PROBABILITY.repeated, days: 59, inquiries: 2 })
    const [enBandeja] = rankCandidates([{ phone_key: 'x', inquiries: o.inquiries, tier: 'NORMAL', is_client: o.isClient, days: o.days, consulted_on: '2026-08-17' }])
    expect(enBandeja).toMatchObject({ probability: o.probability, level: o.level })
    expect(o).toMatchObject({ level: 'ALTA', callable: true })
  })

  it('nuevo que consulto 2 veces en la semana: MEDIA y va a Llamar hoy', () => {
    expect(purchaseOutlook([lead(88, '2026-10-14'), lead(88, '2026-10-10')], '2026-10-15')).toMatchObject({ level: 'MEDIA', callable: true })
  })

  it('nuevo con 1 consulta: BAJA, a la cadencia', () => {
    expect(purchaseOutlook([lead(88, '2026-10-14')], '2026-10-15')).toMatchObject({ level: 'BAJA', callable: false })
  })

  it('consulta de menos de 15 dias es caliente: es el momento de cerrar, sin %', () => {
    expect(purchaseOutlook([lead(88, '2026-10-10')], '2026-10-15')).toMatchObject({ segment: 'CALIENTE', probability: null, days: 5 })
  })

  it('prospecto que nunca compro, dormido: probabilidad baja real', () => {
    expect(purchaseOutlook([lead(88, '2026-09-01')], '2026-10-15')).toMatchObject({ segment: 'FRIO', probability: COLD_PROSPECT_PROBABILITY.single })
  })

  it('si compro despues de su ultima consulta no hay nada que empujar', () => {
    expect(purchaseOutlook([lead(88, '2026-09-01'), erpBuy(88, '2026-09-03')], '2026-10-15').segment).toBe('COMPRO')
  })

  it('mas de 120 dias sin consultar: dormido', () => {
    expect(purchaseOutlook([lead(88, '2026-01-01'), legacyBuy(27, '2025-01-01')], '2026-10-15').segment).toBe('DORMIDO')
  })

  it('sin consultas en el ERP no hay pronostico', () => {
    expect(purchaseOutlook([legacyBuy(27, '2025-01-01')], '2026-10-15')).toBeNull()
  })
})
