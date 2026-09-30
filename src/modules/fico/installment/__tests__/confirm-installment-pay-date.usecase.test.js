import { describe, it, expect, vi, beforeEach } from 'vitest'

const repo = {
  findInstallmentWithStatus: vi.fn(),
  confirmInstallmentTx: vi.fn(),
  syncServiceOrderLeadPayDate: vi.fn(),
  logAudit: vi.fn(),
  syncInstallmentPaymentToOdoo: vi.fn()
}
vi.mock('../installment.repository.js', () => ({ installmentRepository: repo }))
const sendPaymentConfirmationEmail = vi.fn().mockResolvedValue({ success: true })
vi.mock('../../email-confirmation/email-confirmation.usecases.js', () => ({ sendPaymentConfirmationEmail }))

const { confirmInstallment } = await import('../installment.usecases.js')

// Caso 19336 (OS 23/09 cobrada el 24/09): el Sheet leia leads.pay_date y
// seguia en la fecha de registro porque cobrar la cuota nunca tocaba el lead.
describe('confirmInstallment alinea la F.PAGO del lead', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    repo.findInstallmentWithStatus.mockResolvedValue({ installment_number: 1, amount: '1737.00', status_alias: 'we_inst_pending' })
  })

  it('pasa la fecha de pago del formulario al lead', async () => {
    await confirmInstallment({ installmentId: 19849, enrollmentId: 19336, paymentDate: '2026-09-24', userId: 21 })

    expect(repo.syncServiceOrderLeadPayDate).toHaveBeenCalledWith({
      enrollmentId: 19336, installmentId: 19849, payDateIso: '2026-09-24', userId: 21
    })
  })

  it('un fallo al alinear el lead no revierte el cobro', async () => {
    repo.syncServiceOrderLeadPayDate.mockRejectedValueOnce(new Error('trigger'))
    const res = await confirmInstallment({ installmentId: 19849, enrollmentId: 19336, paymentDate: '2026-09-24', userId: 21 })
    expect(res.result).toBe(1)
  })


  // Habia una copia del correo en el repo de cuotas que salia sin email_cc.
  // Solo el sender de email-confirmation aplica la cascada de CC.
  it('manda el correo de cuota por el sender canonico (con CC del enrollment)', async () => {
    await confirmInstallment({ installmentId: 19849, enrollmentId: 19336, paymentDate: '2026-09-24', userId: 21 })
    expect(sendPaymentConfirmationEmail).toHaveBeenCalledWith({ enrollmentId: 19336 })
  })
})
