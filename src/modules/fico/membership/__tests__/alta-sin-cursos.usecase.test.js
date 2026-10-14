import { describe, it, expect, vi } from 'vitest'

// Pedido de FICO (14/10/26): el ERP no crea usuario ni inscribe cursos de una
// membresia en Odoo; el area lo hace a mano. Los jobs siguen llamando a estas
// funciones y deben cerrar en success para no reintentar.

const odoo = { enrollInAllOnlineCourses: vi.fn(), listOnlineChannels: vi.fn() }

vi.mock('../membership.repository.js', () => ({ membershipRepository: {} }))
vi.mock('../../../../shared/adapters/odoo/odoo.adapter.js', () => ({ odoo }))
vi.mock('../../../../shared/adapters/jobs/postgres-queue.adapter.js', () => ({ jobQueue: {} }))

const { createMembershipOdooUser, enrollMembershipInOdoo } =
  await import('../membership.usecases.js')

describe('membresia sin Odoo', () => {
  it.each([
    ['alta del usuario', createMembershipOdooUser],
    ['activacion de cursos', enrollMembershipInOdoo]
  ])('%s no toca Odoo y cierra el job en success', async (_, fn) => {
    const res = await fn({ enrollmentId: 71 })

    expect(res).toMatchObject({ success: true, skipped: true, odoo_user_id: null })
    expect(odoo.enrollInAllOnlineCourses).not.toHaveBeenCalled()
  })
})
