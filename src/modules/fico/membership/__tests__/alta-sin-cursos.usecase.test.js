import { describe, it, expect, vi, beforeEach } from 'vitest'

// Pedido de FICO: las membresias de fico/inscripciones/new no crean usuario
// Odoo (14/10/26, el area lo crea a mano); las demas (lead, B2B) si, en la
// bienvenida (20/10/26). La activacion abre el catalogo sobre la cuenta que
// exista. Si esto se rompe, el socio se queda sin cursos.

const odoo = { enrollInAllOnlineCourses: vi.fn(), listOnlineChannels: vi.fn(), searchUserByEmail: vi.fn() }
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
  buildUniqueOdooEmail: async (first, last) => `${last}.${first}@weeducacion.edu.pe`.toLowerCase(),
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
  odoo.searchUserByEmail.mockImplementation(async login => ({ id: 47438, login }))
  odoo.enrollInAllOnlineCourses.mockResolvedValue({ success: true, odoo_user_id: 9, odoo_login: 'ana@gmail.com' })
})

describe('membresia: usuario manual, cursos automaticos', () => {
  // Caso Scarlet (23288, 19/10/26): venta desde lead sin cuenta; al no crearla,
  // la activacion murio y la socia quedo sin cursos. /new no pasa por aca.
  it('sin cuenta previa la bienvenida crea la @weeducacion con clave por defecto y sin cursos', async () => {
    helper.resolveOdooLogin.mockResolvedValue(null)

    const res = await createMembershipOdooUser({ enrollmentId: 71 })

    expect(res).toMatchObject({ success: true, created: true, odoo_user_id: 9, odoo_login: 'perez.ana@weeducacion.edu.pe' })
    expect(odoo.enrollInAllOnlineCourses).toHaveBeenCalledWith(expect.objectContaining({
      createEmail: 'perez.ana@weeducacion.edu.pe', password: '1234567', channels: []
    }))
    expect(repo.saveOdooCredentials).toHaveBeenCalledWith(
      { enrollmentId: 71, odooUserId: 9, odooEmail: 'perez.ana@weeducacion.edu.pe', odooPassword: '1234567' })
  })

  // Caso Yeremy (enrollment 23070): alumno de SAP con cuenta .weeducacion; el
  // correo de bienvenida le daba su gmail como usuario del campus.
  it('con cuenta previa la bienvenida guarda su login para el correo, sin crear nada', async () => {
    helper.resolveOdooLogin.mockResolvedValue('jimenez.yeremy@weeducacion.edu.pe')

    const res = await createMembershipOdooUser({ enrollmentId: 71 })

    expect(res).toMatchObject({ success: true, odoo_user_id: 47438 })
    expect(repo.saveOdooCredentials).toHaveBeenCalledWith(
      { enrollmentId: 71, odooUserId: 47438, odooEmail: 'jimenez.yeremy@weeducacion.edu.pe', odooPassword: null })
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
