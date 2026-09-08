import { describe, it, expect, vi, beforeEach } from 'vitest'

// Un curso SAP online sin credenciales sale con el correo COMPLETO pero sin el
// bloque de accesos: el alumno no puede entrar al servidor y el sistema marca el
// envio como exitoso. Por eso el envio recupera las credenciales ya persistidas
// cuando el llamador no las trae (cola de register_followup, reenvio, RP/CC).

const CATEGORIA_SAP = 2509
const MODALIDAD_ONLINE = 2623

const repo = {
  clearPriorEmailFailures: vi.fn(),
  findMembershipCheck: vi.fn(),
  findConfirmationDataForSend: vi.fn(),
  setSapCredentials: vi.fn(),
  findSapCredentials: vi.fn(),
  findScheduleForSend: vi.fn().mockResolvedValue([]),
  findInstallments: vi.fn().mockResolvedValue([]),
  hasPriorSuccessfulSend: vi.fn().mockResolvedValue(false),
  hasPriorOdooEnrollment: vi.fn().mockResolvedValue(false),
  isParentProgram: vi.fn().mockResolvedValue(false),
  requiresEmailCc: vi.fn().mockResolvedValue(false),
  insertEmailLog: vi.fn(),
  logAudit: vi.fn().mockResolvedValue(undefined)
}

vi.mock('../email-confirmation.repository.js', () => ({
  emailConfirmationRepository: repo
}))

vi.mock('../../../../utils/catalog-helper.js', () => ({
  getCatalogIdByAlias: vi.fn(async (alias) =>
    alias === 'we_program_category_sap' ? CATEGORIA_SAP : MODALIDAD_ONLINE)
}))

const { sendConfirmationEmail, configureEmailDeps } = await import('../email-confirmation.usecases.js')

const sendEmail = vi.fn()

const CURSO_SAP_ONLINE = {
  enrollment_id: 90,
  first_name: 'Ana',
  last_name: 'Diaz',
  origin_email: 'ana@example.com',
  program_name: 'SAP S/4 HANA MM Online',
  cat_category: CATEGORIA_SAP,
  cat_model_modality: MODALIDAD_ONLINE,
  odoo_email: 'diaz.ana@we.com',
  payment_plan_alias: 'we_payment_plan_single',
  email_cc: null
}

beforeEach(() => {
  vi.clearAllMocks()
  repo.findMembershipCheck.mockResolvedValue({ abbreviation: 'SAP MM', is_membership: 'N', odoo_user_id: 12 })
  repo.findConfirmationDataForSend.mockResolvedValue({ ...CURSO_SAP_ONLINE })
  repo.findSapCredentials.mockResolvedValue(null)
  repo.hasPriorSuccessfulSend.mockResolvedValue(false)
  repo.hasPriorOdooEnrollment.mockResolvedValue(false)
  repo.logAudit.mockResolvedValue(undefined)
  sendEmail.mockResolvedValue({ success: true, messageId: 'msg-1' })
  configureEmailDeps({
    sendEmail,
    getEnrollmentOdoo: vi.fn().mockResolvedValue({ odoo_email: 'diaz.ana@we.com' }),
    enrollInOdoo: vi.fn()
  })
})

const htmlEnviado = () => sendEmail.mock.calls[0][0].htmlBody

describe('credenciales SAP en el correo de confirmacion', () => {
  it('usa las que le pasan y las persiste', async () => {
    repo.setSapCredentials.mockResolvedValue({ sap_username: 'SAP_4001', sap_password: 'clave-nueva' })

    await sendConfirmationEmail({ enrollmentId: 90, sapUsername: 'SAP_4001', sapPassword: 'clave-nueva' })

    expect(repo.setSapCredentials).toHaveBeenCalledWith(90, 'SAP_4001', 'clave-nueva')
    expect(htmlEnviado()).toContain('SAP_4001')
  })

  // La cola de register_followup manda el correo del registro directo y no tiene
  // formulario: sin este rescate el bloque SAP desaparecia sin dejar rastro.
  it('recupera las persistidas cuando el llamador no las trae', async () => {
    repo.findSapCredentials.mockResolvedValue({ sap_username: 'SAP_4002', sap_password: 'clave-guardada' })

    await sendConfirmationEmail({ enrollmentId: 90 })

    expect(repo.setSapCredentials).not.toHaveBeenCalled()
    expect(htmlEnviado()).toContain('SAP_4002')
  })

  it('deja rastro en la bitacora si el correo sale sin credenciales', async () => {
    await sendConfirmationEmail({ enrollmentId: 90 })

    expect(repo.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ enrollmentId: 90, action: 'sap_credentials_missing' })
    )
  })

  it('el borde HTTP manual aborta el envio si no hay ninguna', async () => {
    const res = await sendConfirmationEmail({ enrollmentId: 90, enforceSapCredentials: true })

    expect(res.success).toBe(false)
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
