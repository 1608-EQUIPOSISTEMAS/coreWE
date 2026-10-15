import { describe, it, expect, vi, beforeEach } from 'vitest'

// Pedido de FICO: el ERP no crea el usuario Odoo de una membresia (14/10/26),
// pero SI le abre los cursos del catalogo sobre la cuenta que el area creo a
// mano (15/10/26). Si esto se rompe, o vuelven los socios a medias o el socio
// se queda sin cursos.

const odoo = { enrollInAllOnlineCourses: vi.fn(), listOnlineChannels: vi.fn() }
const repo = {
  findEnrollmentForOdoo: vi.fn(),
  findPreviousOdooUserByDocument: vi.fn(),
  findMembershipCourseIds: vi.fn(),
  saveOdooCredentials: vi.fn()
}
const helper = { resolveOdooLogin: vi.fn() }

vi.mock('../membership.repository.js', () => ({ membershipRepository: repo }))
vi.mock('../../../../shared/adapters/odoo/odoo.adapter.js', () => ({ odoo }))
vi.mock('../../../../shared/adapters/jobs/postgres-queue.adapter.js', () => ({ jobQueue: {} }))
vi.mock('../../../../utils/fico-odoo.helper.js', () => ({
  resolveOdooLogin: (...a) => helper.resolveOdooLogin(...a),
  buildOdooNameParts: ({ firstName, lastName }) => ({ names: firstName, surnames: lastName })
}))

const { createMembershipOdooUser, enrollMembershipInOdoo } =
  await import('../membership.usecases.js')

const socio = { document_number: '45678912', origin_email: 'ana@gmail.com', first_name: 'ANA', last_name: 'PEREZ' }

beforeEach(() => {
  vi.clearAllMocks()
  repo.findEnrollmentForOdoo.mockResolvedValue(socio)
  repo.findPreviousOdooUserByDocument.mockResolvedValue(null)
  repo.findMembershipCourseIds.mockResolvedValue([1])
  odoo.listOnlineChannels.mockResolvedValue([{ id: 1, name: 'Excel' }, { id: 2, name: 'SAP' }])
  odoo.enrollInAllOnlineCourses.mockResolvedValue({ success: true, odoo_user_id: 9, odoo_login: 'ana@gmail.com' })
})

describe('membresia: usuario manual, cursos automaticos', () => {
  it('el alta del usuario no toca Odoo y cierra el job en success', async () => {
    const res = await createMembershipOdooUser({ enrollmentId: 71 })

    expect(res).toMatchObject({ success: true, skipped: true, odoo_user_id: null })
    expect(odoo.enrollInAllOnlineCourses).not.toHaveBeenCalled()
  })

  it('con cuenta existente abre los cursos del catalogo sobre ese login', async () => {
    helper.resolveOdooLogin.mockResolvedValue('ana@gmail.com')

    const res = await enrollMembershipInOdoo({ enrollmentId: 71 })

    expect(res.success).toBe(true)
    expect(odoo.enrollInAllOnlineCourses).toHaveBeenCalledWith(expect.objectContaining({
      searchEmail: 'ana@gmail.com',
      createEmail: 'ana@gmail.com',
      channels: [{ id: 1, name: 'Excel' }]
    }))
    expect(repo.saveOdooCredentials).toHaveBeenCalledWith(expect.objectContaining({ odooUserId: 9, odooPassword: null }))
  })

  it('sin cuenta en Odoo no crea usuario: falla para que el job reintente', async () => {
    helper.resolveOdooLogin.mockResolvedValue(null)

    const res = await enrollMembershipInOdoo({ enrollmentId: 71 })

    expect(res.success).toBe(false)
    expect(res.error).toContain('no tiene usuario en Odoo')
    expect(odoo.enrollInAllOnlineCourses).not.toHaveBeenCalled()
  })

  it('diferida no abre cursos antes de la fecha', async () => {
    repo.findEnrollmentForOdoo.mockResolvedValue({ ...socio, is_deferred: true })

    const res = await enrollMembershipInOdoo({ enrollmentId: 71 })

    expect(res).toMatchObject({ success: true, deferred: true })
    expect(odoo.enrollInAllOnlineCourses).not.toHaveBeenCalled()
  })
})
