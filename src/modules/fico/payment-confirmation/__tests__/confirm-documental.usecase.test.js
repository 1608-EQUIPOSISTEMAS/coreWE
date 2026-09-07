import { describe, it, expect, vi, beforeEach } from 'vitest'

// Confirmacion de una venta con OS/OP: FICO aprueba la inscripcion aunque la
// empresa todavia no haya depositado. Lo que se prueba aqui es el reparto de
// responsabilidades: NO se toca el SP de pagos (no hay pago que grabar) pero SI
// se corren los efectos de acceso (hijos SEG, Odoo, correo), porque el alumno
// entra al campus igual.

const repo = {
  stampApprover: vi.fn(),
  markCheckedWithoutPayment: vi.fn(),
  confirmPaymentSp: vi.fn(),
  findPrevMaxPaymentId: vi.fn().mockResolvedValue(0),
  deactivateObsoletePlaceholder: vi.fn(),
  syncLeadPayDate: vi.fn(),
  markPaymentTokenConfirmed: vi.fn(),
  findMembershipProbe: vi.fn().mockResolvedValue({ abbreviation: 'PC-EZ-02', is_membership: false }),
  computeActivationFacts: vi.fn(),
  persistMembershipActivationDate: vi.fn()
}

vi.mock('../payment-confirmation.repository.js', () => ({
  paymentConfirmationRepository: repo
}))

vi.mock('../../../../shared/event-category.js', () => ({
  isEventEnrollment: vi.fn().mockResolvedValue(false)
}))

const { confirmPayment, setSideEffects } = await import('../payment-confirmation.usecases.js')
const { CONFIRM_DOCUMENTAL } = await import('../payment-confirmation.entity.js')

const sideEffects = {
  validateChildEnrollmentSetup: vi.fn().mockResolvedValue({ ok: true }),
  createChildEnrollments: vi.fn().mockResolvedValue({}),
  enrollInOdoo: vi.fn().mockResolvedValue({ success: true, odoo_user_id: 77, course_search: 'PC-EZ-02' }),
  getEnrollmentOdoo: vi.fn().mockResolvedValue({ odoo_order_id: null }),
  activateFees: vi.fn().mockResolvedValue({ activated: 0 }),
  syncInstallmentPaymentToOdoo: vi.fn().mockResolvedValue({ success: true }),
  logAudit: vi.fn().mockResolvedValue({})
}

const payload = { enrollment_id: 4242, action: CONFIRM_DOCUMENTAL, user_id: 9 }

beforeEach(() => {
  vi.clearAllMocks()
  repo.findPrevMaxPaymentId.mockResolvedValue(0)
  repo.findMembershipProbe.mockResolvedValue({ abbreviation: 'PC-EZ-02', is_membership: false })
  sideEffects.validateChildEnrollmentSetup.mockResolvedValue({ ok: true })
  sideEffects.getEnrollmentOdoo.mockResolvedValue({ odoo_order_id: null })
  setSideEffects(sideEffects)
})

describe('confirmPayment con action confirm_documental', () => {
  it('aprueba sin pasar por el SP de pagos', async () => {
    repo.markCheckedWithoutPayment.mockResolvedValue(1)

    const res = await confirmPayment(payload)

    expect(res.result).toBe(1)
    expect(repo.confirmPaymentSp).not.toHaveBeenCalled()
    expect(repo.markCheckedWithoutPayment).toHaveBeenCalledWith(4242)
  })

  it('le da acceso al alumno igual que una venta pagada', async () => {
    repo.markCheckedWithoutPayment.mockResolvedValue(1)

    await confirmPayment(payload)

    expect(sideEffects.createChildEnrollments).toHaveBeenCalledWith({ enrollmentId: 4242, userId: 9 })
    expect(sideEffects.enrollInOdoo).toHaveBeenCalledWith({ enrollmentId: 4242 })
    expect(sideEffects.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'approved', details: expect.stringContaining('OS/OP') })
    )
  })

  it('no marca cuota pagada en Odoo: la plata no ha llegado', async () => {
    repo.markCheckedWithoutPayment.mockResolvedValue(1)

    await confirmPayment(payload)

    expect(sideEffects.syncInstallmentPaymentToOdoo).not.toHaveBeenCalled()
  })

  it('no toca leads.pay_date ni el placeholder de pagos', async () => {
    repo.markCheckedWithoutPayment.mockResolvedValue(1)
    repo.findPrevMaxPaymentId.mockResolvedValue(500)

    await confirmPayment(payload)

    expect(repo.syncLeadPayDate).not.toHaveBeenCalled()
    expect(repo.deactivateObsoletePlaceholder).not.toHaveBeenCalled()
  })

  it('el segundo click no vuelve a matricular ni a mandar correo', async () => {
    repo.markCheckedWithoutPayment.mockResolvedValue(0)

    const res = await confirmPayment(payload)

    expect(res).toEqual(expect.objectContaining({ result: 1, already_confirmed: true }))
    expect(sideEffects.createChildEnrollments).not.toHaveBeenCalled()
    expect(sideEffects.enrollInOdoo).not.toHaveBeenCalled()
  })
})

// Quien aprueba tiene que quedar grabado en la FILA, no solo en el log: el
// trigger fn_audit_changes lee el autor de user_modification_id, asi que sin
// este sello la bitacora nombra al ultimo que edito la venta (el comercial que
// la registro) y no a quien la aprobo.
describe('trazabilidad de la aprobacion', () => {
  it('sella al aprobador ANTES de cambiar el estado', async () => {
    repo.markCheckedWithoutPayment.mockResolvedValue(1)

    await confirmPayment(payload)

    expect(repo.stampApprover).toHaveBeenCalledWith(4242, 9)
    expect(repo.stampApprover.mock.invocationCallOrder[0])
      .toBeLessThan(repo.markCheckedWithoutPayment.mock.invocationCallOrder[0])
  })

  it('tambien sella en la confirmacion con pago, que va por el SP', async () => {
    repo.confirmPaymentSp.mockResolvedValue({ result: 1 })

    await confirmPayment({ enrollment_id: 4242, action: 'confirm', user_id: 9 })

    expect(repo.stampApprover).toHaveBeenCalledWith(4242, 9)
    expect(repo.stampApprover.mock.invocationCallOrder[0])
      .toBeLessThan(repo.confirmPaymentSp.mock.invocationCallOrder[0])
  })

  it('un fallo al sellar no tumba la confirmacion', async () => {
    repo.stampApprover.mockRejectedValueOnce(new Error('socket perdido'))
    repo.markCheckedWithoutPayment.mockResolvedValue(1)

    const res = await confirmPayment(payload)

    expect(res.result).toBe(1)
  })
})
