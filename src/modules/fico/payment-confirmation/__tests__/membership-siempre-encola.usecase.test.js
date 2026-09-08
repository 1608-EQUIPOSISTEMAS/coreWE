import { describe, it, expect, vi, beforeEach } from 'vitest'

// Confirmar una membresia SIEMPRE deja el correo de bienvenida en manos de la
// cola, difiera la activacion o no. Antes solo se encolaba la diferida y la
// inmediata dependia de que el navegador de FICO hiciera una 2da llamada: si no
// ocurria, el alumno se quedaba sin credenciales y no quedaba rastro del fallo
// (enrollment 18403, 2026-09-03).

const repo = {
  stampApprover: vi.fn(),
  markCheckedWithoutPayment: vi.fn(),
  confirmPaymentSp: vi.fn(),
  findPrevMaxPaymentId: vi.fn().mockResolvedValue(0),
  deactivateObsoletePlaceholder: vi.fn(),
  syncLeadPayDate: vi.fn(),
  markPaymentTokenConfirmed: vi.fn(),
  findMembershipProbe: vi.fn(),
  computeActivationFacts: vi.fn(),
  persistMembershipActivationDate: vi.fn(),
  findInstallmentStatusAlias: vi.fn().mockResolvedValue(null)
}

vi.mock('../payment-confirmation.repository.js', () => ({
  paymentConfirmationRepository: repo
}))

vi.mock('../../../../shared/event-category.js', () => ({
  isEventEnrollment: vi.fn().mockResolvedValue(false)
}))

const { confirmPayment, setSideEffects } = await import('../payment-confirmation.usecases.js')
const { CONFIRM_CONTADO } = await import('../payment-confirmation.entity.js')

const sideEffects = {
  validateChildEnrollmentSetup: vi.fn().mockResolvedValue({ ok: true }),
  createChildEnrollments: vi.fn().mockResolvedValue({}),
  enrollInOdoo: vi.fn().mockResolvedValue({ success: true, odoo_user_id: 77 }),
  getEnrollmentOdoo: vi.fn().mockResolvedValue({ odoo_order_id: null }),
  activateFees: vi.fn().mockResolvedValue({ activated: 0 }),
  syncInstallmentPaymentToOdoo: vi.fn().mockResolvedValue({ success: true }),
  logAudit: vi.fn().mockResolvedValue({})
}

const jobQueue = { enqueue: vi.fn(), rescheduleJob: vi.fn() }

const payload = { enrollment_id: 4242, action: CONFIRM_CONTADO, user_id: 9 }

beforeEach(() => {
  vi.clearAllMocks()
  repo.confirmPaymentSp.mockResolvedValue({ result: 1, enrollment_id: 4242 })
  repo.findPrevMaxPaymentId.mockResolvedValue(0)
  repo.findMembershipProbe.mockResolvedValue({ abbreviation: 'WE PLUS', is_membership: 'Y' })
  sideEffects.getEnrollmentOdoo.mockResolvedValue({ odoo_order_id: null })
  jobQueue.enqueue.mockResolvedValue({ job_id: '900' })
  setSideEffects(sideEffects)
})

describe('confirmPayment de una membresia', () => {
  it('encola la activacion inmediata para que el correo no dependa del navegador', async () => {
    const res = await confirmPayment(payload, { jobQueue })

    expect(jobQueue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      jobType: 'membership_activation',
      enrollmentId: 4242,
      runAt: null // sin fecha futura: el worker lo reclama en el proximo poll
    }))
    expect(res.membership_queued).toBe(true)
    expect(res.membership_deferred).toBeUndefined()
  })

  it('no dispara Odoo sincronicamente: de eso se encarga el job', async () => {
    await confirmPayment(payload, { jobQueue })

    expect(sideEffects.enrollInOdoo).not.toHaveBeenCalled()
  })

  it('con activacion futura encola para esa fecha y lo marca como diferido', async () => {
    repo.computeActivationFacts.mockResolvedValue({
      is_today_or_past: false,
      out_of_window: false,
      activation_date: '2026-09-06',
      run_at: '2026-09-06T14:00:00.000Z'
    })

    const res = await confirmPayment({ ...payload, activation_date: '2026-09-06' }, { jobQueue })

    expect(jobQueue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      jobType: 'membership_activation',
      runAt: '2026-09-06T14:00:00.000Z'
    }))
    // La bienvenida NO espera a esa fecha: el socio recibe credenciales hoy.
    expect(jobQueue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      jobType: 'membership_welcome',
      runAt: null
    }))
    expect(res.membership_queued).toBe(true)
    expect(res.membership_deferred).toBe(true)
  })

  it('si la cola falla, el frontend sigue siendo el plan B', async () => {
    jobQueue.enqueue.mockRejectedValue(new Error('cola caida'))

    const res = await confirmPayment(payload, { jobQueue })

    expect(res.result).toBe(1)
    expect(res.membership_queued).toBeUndefined()
  })

  it('un curso normal no toca la cola de membresia', async () => {
    repo.findMembershipProbe.mockResolvedValue({ abbreviation: 'PC-EZ-02', is_membership: 'N' })

    const res = await confirmPayment(payload, { jobQueue })

    expect(jobQueue.enqueue).not.toHaveBeenCalled()
    expect(res.membership_queued).toBeUndefined()
    expect(sideEffects.enrollInOdoo).toHaveBeenCalled()
  })
})
