import { describe, it, expect, vi, beforeEach } from 'vitest'

// Pedido de FICO (sept/26): el correo de ultima cuota decia "ULTIMO PAGO
// REALIZADO: <fecha de vencimiento>". Si la cuota vencia el 10/08 y el alumno
// pago el 15/08, el correo le anunciaba el 10/08. Ahora manda la fecha real del
// pago (payments.payment_date) y el vencimiento queda solo de respaldo para las
// cuotas viejas sin fila en payments.

const repo = {
  findPaymentConfirmationData: vi.fn(),
  findInstallmentsWithStatus: vi.fn(),
  insertEmailLog: vi.fn().mockResolvedValue(undefined),
  requiresEmailCc: vi.fn().mockResolvedValue(false),
  logAudit: vi.fn().mockResolvedValue(undefined)
}

vi.mock('../email-confirmation.repository.js', () => ({
  emailConfirmationRepository: repo
}))

const { sendPaymentConfirmationEmail, configureEmailDeps } = await import('../email-confirmation.usecases.js')

const sendFicoEmail = vi.fn()
const ALUMNO = {
  first_name: 'Khiara',
  last_name: 'Martinez',
  origin_email: 'khiara@example.com',
  category_description: 'Curso',
  currency_symbol: 'S/.',
  email_cc: null
}

// Dos cuotas, ambas pagadas: dispara la rama "Pago Completado".
const cuotasPagadas = (paidAt) => ([
  { installment_number: 1, amount: 500, due_date: '2026-07-10', status_alias: 'we_inst_paid', paid_at: '2026-07-10' },
  { installment_number: 2, amount: 500, due_date: '2026-08-10', status_alias: 'we_inst_paid', paid_at: paidAt }
])

const htmlEnviado = () => sendFicoEmail.mock.calls[0][0].htmlBody

beforeEach(() => {
  vi.clearAllMocks()
  repo.findPaymentConfirmationData.mockResolvedValue({ ...ALUMNO })
  sendFicoEmail.mockResolvedValue({ success: true, messageId: 'msg-1' })
  configureEmailDeps({ sendFicoEmail })
})

describe('correo de ultima cuota', () => {
  it('anuncia la fecha en que pago, no la del vencimiento', async () => {
    repo.findInstallmentsWithStatus.mockResolvedValue(cuotasPagadas('2026-08-15'))

    await sendPaymentConfirmationEmail({ enrollmentId: 42 })

    expect(htmlEnviado()).toContain('15/08/2026')
    expect(htmlEnviado()).not.toContain('10/08/2026')
  })

  it('cae al vencimiento si la cuota no tiene registro de pago', async () => {
    repo.findInstallmentsWithStatus.mockResolvedValue(cuotasPagadas(null))

    await sendPaymentConfirmationEmail({ enrollmentId: 42 })

    expect(htmlEnviado()).toContain('10/08/2026')
  })

  // Un pago nocturno llega como timestamp; el SQL lo castea a ::date justamente
  // para que la plantilla (que formatea en UTC) no lo corra al dia siguiente.
  it('no corre el dia cuando la fecha viene con hora', async () => {
    repo.findInstallmentsWithStatus.mockResolvedValue(cuotasPagadas('2026-08-15'))

    await sendPaymentConfirmationEmail({ enrollmentId: 42 })

    expect(htmlEnviado()).not.toContain('16/08/2026')
  })
})
