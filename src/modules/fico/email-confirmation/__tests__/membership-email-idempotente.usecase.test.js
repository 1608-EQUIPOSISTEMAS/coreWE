import { describe, it, expect, vi, beforeEach } from 'vitest'

// El job de membresia y el reenvio manual de FICO pueden apuntar al mismo
// enrollment. skipIfSentAfter evita que el alumno reciba sus credenciales dos
// veces cuando el job llega tarde a un correo que ya salio por otro camino,
// SIN bloquear el reenvio manual, que es una accion deliberada de FICO.

const repo = {
  hasSuccessfulSendSince: vi.fn(),
  hasPriorSuccessfulSend: vi.fn().mockResolvedValue(false),
  findMembershipDataForSend: vi.fn(),
  findInstallments: vi.fn().mockResolvedValue([]),
  insertEmailLog: vi.fn(),
  requiresEmailCc: vi.fn().mockResolvedValue(false),
  saveEmailCc: vi.fn()
}

vi.mock('../email-confirmation.repository.js', () => ({
  emailConfirmationRepository: repo
}))

const { sendMembershipEmail, configureEmailDeps } = await import('../email-confirmation.usecases.js')

const sendEmail = vi.fn()
const DATOS_COMPLETOS = {
  enrollment_id: 55,
  first_name: 'Ana',
  last_name: 'Diaz',
  origin_email: 'ana@example.com',
  program_name: 'WE PLUS',
  odoo_user_id: 12,
  odoo_email: 'diaz.ana@we.com',
  membership_activation_date: null,
  payment_plan_alias: 'we_payment_plan_single',
  email_cc: null
}

beforeEach(() => {
  vi.clearAllMocks()
  repo.findMembershipDataForSend.mockResolvedValue({ ...DATOS_COMPLETOS })
  repo.hasPriorSuccessfulSend.mockResolvedValue(false)
  sendEmail.mockResolvedValue({ success: true, messageId: 'msg-1' })
  configureEmailDeps({ sendEmail, createMembershipOdooUser: vi.fn() })
})

describe('sendMembershipEmail con skipIfSentAfter', () => {
  it('no reenvia si el correo ya salio despues de ese instante', async () => {
    repo.hasSuccessfulSendSince.mockResolvedValue(true)

    const res = await sendMembershipEmail({ enrollmentId: 55, skipIfSentAfter: '2026-09-03T22:00:00Z' })

    expect(res).toMatchObject({ success: true, skipped: true })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(repo.insertEmailLog).not.toHaveBeenCalled()
  })

  it('manda si todavia no salio nada despues de ese instante', async () => {
    repo.hasSuccessfulSendSince.mockResolvedValue(false)

    const res = await sendMembershipEmail({ enrollmentId: 55, skipIfSentAfter: '2026-09-03T22:00:00Z' })

    expect(res.success).toBe(true)
    expect(sendEmail).toHaveBeenCalledOnce()
  })

  it('el reenvio manual de FICO no consulta la guarda y siempre manda', async () => {
    await sendMembershipEmail({ enrollmentId: 55 })

    expect(repo.hasSuccessfulSendSince).not.toHaveBeenCalled()
    expect(sendEmail).toHaveBeenCalledOnce()
  })
})
