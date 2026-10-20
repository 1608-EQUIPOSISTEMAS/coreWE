import { describe, it, expect, vi } from 'vitest'

const ROWS = [
  { installment_id: 1, amount: '100.00', currency: 'PEN', state_label: 'overdue' },
  { installment_id: 2, amount: '50.50', currency: 'PEN', state_label: 'today' }
]

vi.mock('../installment.repository.js', () => ({
  installmentRepository: { listCollections: vi.fn(async () => ROWS) }
}))

const { getCollections } = await import('../installment.usecases.js')
const { installmentRepository } = await import('../installment.repository.js')

describe('getCollections', () => {
  // Los filtros y KPIs viven en el front (collectionView.js): el backend
  // entrega el mes entero sin recortar.
  it('devuelve todas las cuotas pendientes del mes', async () => {
    const { items } = await getCollections({ year: 2026, month: 7 })
    expect(items).toBe(ROWS)
    expect(installmentRepository.listCollections).toHaveBeenCalledWith({ year: 2026, month: 7 })
  })
})
