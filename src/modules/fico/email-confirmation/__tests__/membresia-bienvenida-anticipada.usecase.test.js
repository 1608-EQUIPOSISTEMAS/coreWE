import { describe, it, expect, vi, beforeEach } from 'vitest'

// Pedido de FICO (sept/26): el socio recibe la bienvenida el dia que se inscribe,
// aunque haya elegido activar meses despues. Antes el correo y la activacion eran
// el mismo job diferido, asi que el alumno no sabia nada hasta la fecha elegida.
//
// La contraparte esta en membership.usecases: el usuario Odoo se crea SIN cursos
// (createMembershipOdooUser), para que las credenciales del correo sean reales
// pero el acceso siga empezando en la fecha de activacion.

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
const createMembershipOdooUser = vi.fn()

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
  createMembershipOdooUser.mockResolvedValue({ success: true, odoo_user_id: 12 })
  configureEmailDeps({ sendEmail, createMembershipOdooUser })
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

  // Sin usuario en Odoo las credenciales del correo serian inventadas. Se crea la
  // cuenta, pero SIN cursos: abrirlos aqui adelantaria la activacion.
  it('crea el usuario Odoo sin abrirle los cursos', async () => {
    repo.findMembershipDataForSend
      .mockResolvedValueOnce({ ...ACTIVACION_FUTURA, odoo_user_id: null })
      .mockResolvedValue({ ...ACTIVACION_FUTURA })

    await sendMembershipEmail({ enrollmentId: 71 })

    expect(createMembershipOdooUser).toHaveBeenCalledWith({ enrollmentId: 71 })
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it('no manda credenciales falsas si el alta en Odoo falla', async () => {
    repo.findMembershipDataForSend.mockResolvedValue({ ...ACTIVACION_FUTURA, odoo_user_id: null })
    createMembershipOdooUser.mockResolvedValue({ success: false, error: 'Odoo caido' })

    const res = await sendMembershipEmail({ enrollmentId: 71 })

    expect(res.success).toBe(false)
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
