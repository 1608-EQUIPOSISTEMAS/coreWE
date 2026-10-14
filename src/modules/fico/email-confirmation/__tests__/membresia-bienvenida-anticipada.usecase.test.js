import { describe, it, expect, vi, beforeEach } from 'vitest'

// Pedido de FICO (sept/26): el socio recibe la bienvenida el dia que se inscribe,
// aunque haya elegido activar meses despues. Antes el correo y la activacion eran
// el mismo job diferido, asi que el alumno no sabia nada hasta la fecha elegida.

const repo = {
  hasSuccessfulSendSince: vi.fn().mockResolvedValue(false),
  hasPriorSuccessfulSend: vi.fn().mockResolvedValue(false),
  findMembershipDataForSend: vi.fn(),
  findInstallments: vi.fn().mockResolvedValue([]),
  insertEmailLog: vi.fn().mockResolvedValue(undefined),
  requiresEmailCc: vi.fn().mockResolvedValue(false),
  logAudit: vi.fn().mockResolvedValue(undefined)
}

vi.mock('../email-confirmation.repository.js', () => ({
  emailConfirmationRepository: repo
}))

const { sendMembershipEmail, configureEmailDeps } = await import('../email-confirmation.usecases.js')

const sendEmail = vi.fn()

const ACTIVACION_FUTURA = {
  enrollment_id: 71,
  first_name: 'Ana',
  last_name: 'Diaz',
  origin_email: 'ana@example.com',
  program_name: 'WE GOLD',
  odoo_user_id: 12,
  odoo_email: 'diaz.ana@we.com',
  membership_activation_date: '2027-03-01',
  payment_plan_alias: 'we_payment_plan_single',
  email_cc: null
}

beforeEach(() => {
  vi.clearAllMocks()
  repo.findMembershipDataForSend.mockResolvedValue({ ...ACTIVACION_FUTURA })
  repo.hasSuccessfulSendSince.mockResolvedValue(false)
  repo.hasPriorSuccessfulSend.mockResolvedValue(false)
  sendEmail.mockResolvedValue({ success: true, messageId: 'msg-1' })
  configureEmailDeps({ sendEmail })
})

describe('bienvenida de membresia con activacion futura', () => {
  it('sale hoy en vez de esperar a la fecha de activacion', async () => {
    const res = await sendMembershipEmail({ enrollmentId: 71 })

    expect(res.success).toBe(true)
    expect(res.deferred).toBeUndefined()
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it('anuncia la fecha en que arranca el acceso', async () => {
    await sendMembershipEmail({ enrollmentId: 71 })

    expect(sendEmail.mock.calls[0][0].htmlBody).toContain('01/03/2027')
  })

  // El ERP ya no crea la cuenta Odoo (14/10/26): el usuario del campus es el
  // correo que registro el alumno, y el area crea la cuenta a mano con el.
  it('sin cuenta Odoo usa el correo registrado como usuario', async () => {
    repo.findMembershipDataForSend.mockResolvedValue({ ...ACTIVACION_FUTURA, odoo_user_id: null, odoo_email: null })

    const res = await sendMembershipEmail({ enrollmentId: 71 })

    expect(res.success).toBe(true)
    expect(sendEmail.mock.calls[0][0].htmlBody).toContain('ana@example.com')
    expect(sendEmail.mock.calls[0][0].htmlBody).not.toContain('diaz.ana@we.com')
  })

  it('una membresia vieja con cuenta Odoo conserva su login real', async () => {
    await sendMembershipEmail({ enrollmentId: 71 })

    expect(sendEmail.mock.calls[0][0].htmlBody).toContain('diaz.ana@we.com')
  })
})
