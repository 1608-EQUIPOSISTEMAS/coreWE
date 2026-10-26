import { describe, it, expect, vi, beforeEach } from 'vitest'

// Caso Diana (23288, 19/10/26): la activacion agoto sus 5 intentos y quedo
// 'failed' sin que nadie se enterara. La ficha deja relanzarla.

const repo = { findMembershipProbeWithActivationState: vi.fn(), logAudit: vi.fn() }
const jobQueue = { enqueue: vi.fn() }
const ports = { getLatestJobByEnrollment: vi.fn() }

vi.mock('../membership.repository.js', () => ({ membershipRepository: repo }))
vi.mock('../../../../shared/adapters/odoo/odoo.adapter.js', () => ({ odoo: {} }))
vi.mock('../../../../shared/adapters/jobs/postgres-queue.adapter.js', () => ({ jobQueue }))
vi.mock('../membership.ports.js', () => ({ getLatestJobByEnrollment: (...a) => ports.getLatestJobByEnrollment(...a) }))

const { retryMembershipActivation } = await import('../membership.usecases.js')

beforeEach(() => {
  vi.clearAllMocks()
  repo.findMembershipProbeWithActivationState.mockResolvedValue({ abbreviation: 'WE PLUS', is_membership: true })
  jobQueue.enqueue.mockResolvedValue({ job_id: 1800, status: 'pending', created_at: 'c' })
})

describe('retryMembershipActivation', () => {
  it('encola un job nuevo de activacion y deja rastro en el audit log', async () => {
    ports.getLatestJobByEnrollment.mockResolvedValue({ job_id: 1670, status: 'failed' })

    const res = await retryMembershipActivation({ enrollmentId: 23288, userId: 22 })

    expect(jobQueue.enqueue).toHaveBeenCalledWith({
      jobType: 'membership_activation', enrollmentId: 23288, payload: { enrollmentId: 23288 }
    })
    expect(repo.logAudit).toHaveBeenCalledWith(expect.objectContaining({
      enrollmentId: 23288, action: 'membership_activation_retried', userId: 22
    }))
    expect(res).toMatchObject({ status: 'pending', jobId: 1800, canRetry: false })
  })

  it('no encola nada si la activacion no fallo', async () => {
    ports.getLatestJobByEnrollment.mockResolvedValue({ job_id: 1670, status: 'done' })

    await expect(retryMembershipActivation({ enrollmentId: 23288, userId: 22 })).rejects.toThrow(/No hay una activacion fallida/)
    expect(jobQueue.enqueue).not.toHaveBeenCalled()
    expect(repo.logAudit).not.toHaveBeenCalled()
  })
})
