import { describe, it, expect, vi } from 'vitest'

vi.mock('../installment.repository.js', () => ({
  installmentRepository: {
    listCollections: vi.fn().mockResolvedValue([
      { installment_id: 1, amount: '100.00', currency: 'PEN', state_label: 'overdue' },
      { installment_id: 2, amount: '50.50', currency: 'PEN', state_label: 'today' },
      { installment_id: 3, amount: '200.00', currency: 'PEN', state_label: 'upcoming' },
      { installment_id: 4, amount: '25.00', currency: 'PEN', state_label: 'overdue' },
      { installment_id: 5, amount: '93.00', currency: 'USD', state_label: 'overdue' }
    ])
  }
}))

const { getCollections } = await import('../installment.usecases.js')

describe('getCollections', () => {
  it('agrega KPIs por estado con soles y dolares por separado (no se suman)', async () => {
    const { kpis, items } = await getCollections({ year: 2026, month: 7 })
    expect(items).toHaveLength(5)
    expect(kpis).toEqual({
      total_count: 5, total_amount_pen: 375.5, total_amount_usd: 93,
      overdue_count: 3, overdue_amount_pen: 125, overdue_amount_usd: 93,
      today_count: 1, today_amount_pen: 50.5, today_amount_usd: 0,
      upcoming_count: 1, upcoming_amount_pen: 200, upcoming_amount_usd: 0
    })
  })

  it('filtra items por estado sin alterar los KPIs', async () => {
    const { kpis, items } = await getCollections({ year: 2026, month: 7, state: 'overdue' })
    expect(items.map(i => i.installment_id)).toEqual([1, 4, 5])
    expect(kpis.total_count).toBe(5)
  })
})
