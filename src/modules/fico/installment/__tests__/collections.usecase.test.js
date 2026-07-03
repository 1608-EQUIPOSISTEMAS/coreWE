import { describe, it, expect, vi } from 'vitest'

vi.mock('../installment.repository.js', () => ({
  installmentRepository: {
    listCollections: vi.fn().mockResolvedValue([
      { installment_id: 1, amount: '100.00', state_label: 'overdue' },
      { installment_id: 2, amount: '50.50', state_label: 'today' },
      { installment_id: 3, amount: '200.00', state_label: 'upcoming' },
      { installment_id: 4, amount: '25.00', state_label: 'overdue' }
    ])
  }
}))

const { getCollections } = await import('../installment.usecases.js')

describe('getCollections', () => {
  it('agrega KPIs por estado sobre todo el mes', async () => {
    const { kpis, items } = await getCollections({ year: 2026, month: 7 })
    expect(items).toHaveLength(4)
    expect(kpis).toEqual({
      total_count: 4, total_amount: 375.5,
      overdue_count: 2, overdue_amount: 125,
      today_count: 1, today_amount: 50.5,
      upcoming_count: 1, upcoming_amount: 200
    })
  })

  it('filtra items por estado sin alterar los KPIs', async () => {
    const { kpis, items } = await getCollections({ year: 2026, month: 7, state: 'overdue' })
    expect(items.map(i => i.installment_id)).toEqual([1, 4])
    expect(kpis.total_count).toBe(4)
  })
})
