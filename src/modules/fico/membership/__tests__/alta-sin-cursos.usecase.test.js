import { describe, it, expect, vi, beforeEach } from 'vitest'

// La bienvenida sale el dia de la inscripcion, asi que el socio necesita su
// usuario de Odoo creado ese mismo dia. Pero abrirle los cursos ahi seria
// adelantarle la activacion que el mismo pidio para despues: por eso el alta va
// con la lista de canales VACIA y los cursos los abre el job del dia de la fecha.

const repo = {
  findEnrollmentForOdoo: vi.fn(),
  findPreviousOdooUserByDocument: vi.fn().mockResolvedValue(null),
  findMembershipCourseIds: vi.fn().mockResolvedValue([101]),
  saveOdooCredentials: vi.fn().mockResolvedValue(undefined)
}
const odoo = {
  enrollInAllOnlineCourses: vi.fn(),
  listOnlineChannels: vi.fn().mockResolvedValue([{ id: 101, name: 'Excel' }, { id: 102, name: 'Power BI' }])
}

vi.mock('../membership.repository.js', () => ({ membershipRepository: repo }))
vi.mock('../../../../shared/adapters/odoo/odoo.adapter.js', () => ({ odoo }))
vi.mock('../../../../shared/adapters/jobs/postgres-queue.adapter.js', () => ({ jobQueue: {} }))
vi.mock('../../../../utils/fico-odoo.helper.js', () => ({
  buildUniqueOdooEmail: vi.fn().mockResolvedValue('diaz.ana@we.com'),
  buildOdooNameParts: () => ({ names: 'ANA', surnames: 'DIAZ' }),
  resolveOdooLogin: vi.fn().mockResolvedValue('diaz.ana@we.com')
}))

const { createMembershipOdooUser, enrollMembershipInOdoo } =
  await import('../membership.usecases.js')

const SOCIO = {
  enrollment_id: 71,
  first_name: 'Ana',
  last_name: 'Diaz',
  mother_last_name: 'Ruiz',
  document_number: '70123456',
  origin_email: 'ana@example.com',
  origin_phone: '999888777',
  membership_activation_date: '2027-03-01',
  is_deferred: true
}

const canalesUsados = () => odoo.enrollInAllOnlineCourses.mock.calls[0][0].channels

beforeEach(() => {
  vi.clearAllMocks()
  repo.findEnrollmentForOdoo.mockResolvedValue({ ...SOCIO })
  repo.findMembershipCourseIds.mockResolvedValue([101])
  odoo.enrollInAllOnlineCourses.mockResolvedValue({
    success: true, odoo_user_id: 55, odoo_login: 'diaz.ana@we.com', password_set: '1234567'
  })
})

describe('createMembershipOdooUser', () => {
  it('crea el usuario sin inscribirlo en ningun curso', async () => {
    const res = await createMembershipOdooUser({ enrollmentId: 71 })

    expect(res.success).toBe(true)
    expect(canalesUsados()).toEqual([])
  })

  // La fecha futura NO lo frena: ese candado es de la activacion, no del alta.
  it('corre aunque la activacion sea futura', async () => {
    await createMembershipOdooUser({ enrollmentId: 71 })

    expect(odoo.enrollInAllOnlineCourses).toHaveBeenCalled()
    expect(repo.saveOdooCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ enrollmentId: 71, odooUserId: 55 })
    )
  })
})

describe('enrollMembershipInOdoo', () => {
  it('con activacion futura no abre nada', async () => {
    const res = await enrollMembershipInOdoo({ enrollmentId: 71 })

    expect(res).toMatchObject({ success: true, deferred: true })
    expect(odoo.enrollInAllOnlineCourses).not.toHaveBeenCalled()
  })

  it('llegada la fecha abre los cursos del catalogo de membresia', async () => {
    repo.findEnrollmentForOdoo.mockResolvedValue({ ...SOCIO, is_deferred: false })

    await enrollMembershipInOdoo({ enrollmentId: 71 })

    expect(canalesUsados()).toEqual([{ id: 101, name: 'Excel' }])
  })
})
