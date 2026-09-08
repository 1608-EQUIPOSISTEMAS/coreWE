import { describe, it, expect, vi, beforeEach } from 'vitest'

// Un paquete sin edicion (E0 en vivo, o producto online que por diseño no tiene
// program_editions) no tiene curso propio en el campus: lo que se inscribe en
// Odoo son sus modulos. Antes se devolvia `success: true` sin inscribir a nadie
// y el correo de confirmacion anunciaba credenciales de un usuario inexistente.

const repo = {
  findE0Check: vi.fn(),
  findChildEnrollmentIds: vi.fn(),
  findPreCheck: vi.fn().mockResolvedValue(null),
  findEnrollmentForSync: vi.fn(),
  findPrevOdooUser: vi.fn().mockResolvedValue(null),
  updateOdooUser: vi.fn(),
  findInstallments: vi.fn().mockResolvedValue([]),
  findEnrollmentAmounts: vi.fn().mockResolvedValue({ total_amount: 0 }),
  updateOdooOrderId: vi.fn(),
  logAudit: vi.fn()
}

const odoo = {
  searchSlideChannelByName: vi.fn(),
  syncStudentToOdooOnline: vi.fn(),
  createSaleOrderWithFees: vi.fn().mockResolvedValue({ success: false }),
  activateFees: vi.fn()
}

vi.mock('../odoo-sync.repository.js', () => ({ odooSyncRepository: repo }))
vi.mock('../../../../shared/adapters/odoo/odoo.adapter.js', () => ({ odoo }))
vi.mock('../../../../shared/event-category.js', () => ({ isEventEnrollment: vi.fn().mockResolvedValue(false) }))
vi.mock('../../../../utils/catalog-helper.js', () => ({ getCatalogIdByAlias: vi.fn().mockResolvedValue(2623) }))
vi.mock('../../../../utils/fico-odoo.helper.js', () => ({
  buildUniqueOdooEmail: vi.fn().mockResolvedValue('bonifacio.christian@weeducacion.edu.pe'),
  resolveOdooLogin: vi.fn().mockResolvedValue('bonifacio.christian@weeducacion.edu.pe'),
  buildOdooNameParts: () => ({ names: 'CHRISTIAN', surnames: 'BONIFACIO CHAVEZ' })
}))

const { enrollInOdoo } = await import('../odoo-sync.usecases.js')

const PAQUETE = 18632
const MODULOS = [18633, 18634, 18635]

// Modalidad online: el programa del modulo tiene canal en el campus, el paquete no.
const DATOS_MODULO = {
  first_name: 'CHRISTIAN',
  last_name: 'BONIFACIO CHAVEZ',
  document_number: null,
  odoo_activation: 'SAP S/4 HANA MM Online',
  cat_model_modality: 2623
}

beforeEach(() => {
  vi.clearAllMocks()
  repo.findPreCheck.mockResolvedValue(null)
  repo.findEnrollmentForSync.mockResolvedValue({ ...DATOS_MODULO })
  repo.findPrevOdooUser.mockResolvedValue(null)
  // El paquete no tiene edicion pero si modulos en la estructura; sus modulos
  // tampoco tienen edicion (producto online) y no son paquetes a su vez.
  repo.findE0Check.mockImplementation(async (id) =>
    id === PAQUETE
      ? { program_edition_id: null, children_count: 3 }
      : { program_edition_id: null, children_count: 0 })
  repo.findChildEnrollmentIds.mockResolvedValue(MODULOS)
  odoo.searchSlideChannelByName.mockResolvedValue([{ id: 77, name: 'SAP S/4 HANA MM Online' }])
  odoo.syncStudentToOdooOnline.mockResolvedValue({
    success: true,
    odoo_user_id: 51234,
    odoo_student_id: 9001,
    odoo_partner_id: 4321,
    odoo_login: 'bonifacio.christian@weeducacion.edu.pe',
    password_set: '1234567'
  })
  odoo.createSaleOrderWithFees.mockResolvedValue({ success: false })
})

describe('enrollInOdoo — paquete sin edicion', () => {
  it('inscribe cada modulo del paquete en Odoo', async () => {
    await enrollInOdoo({ enrollmentId: PAQUETE })

    expect(odoo.syncStudentToOdooOnline).toHaveBeenCalledTimes(MODULOS.length)
    for (const moduloId of MODULOS) {
      expect(repo.updateOdooUser).toHaveBeenCalledWith(
        expect.objectContaining({ enrollmentId: moduloId, odooUserId: 51234 })
      )
    }
  })

  it('hereda al padre el login real, que es el que pinta el correo', async () => {
    const res = await enrollInOdoo({ enrollmentId: PAQUETE })

    expect(res.success).toBe(true)
    expect(res.odoo_user_id).toBe(51234)
    expect(repo.updateOdooUser).toHaveBeenCalledWith(
      expect.objectContaining({
        enrollmentId: PAQUETE,
        odooUserId: 51234,
        odooEmail: 'bonifacio.christian@weeducacion.edu.pe'
      })
    )
  })

  it('no devuelve usuario cuando el paquete aun no tiene modulos matriculados', async () => {
    repo.findChildEnrollmentIds.mockResolvedValue([])

    const res = await enrollInOdoo({ enrollmentId: PAQUETE })

    // success sin odoo_user_id: no hay nada roto, pero tampoco credenciales que
    // anunciar. El correo lo lee como "no hay alumno en Odoo" y no sale.
    expect(res).toMatchObject({ success: true, skipped: true, odoo_user_id: null })
    expect(odoo.syncStudentToOdooOnline).not.toHaveBeenCalled()
  })

  it('falla si ningun modulo pudo inscribirse, en vez de reportar exito', async () => {
    odoo.searchSlideChannelByName.mockResolvedValue([])

    const res = await enrollInOdoo({ enrollmentId: PAQUETE })

    expect(res.success).toBe(false)
    expect(res.odoo_user_id).toBeNull()
    expect(res.error).toMatch(/Curso online no encontrado/)
    expect(repo.updateOdooUser).not.toHaveBeenCalledWith(
      expect.objectContaining({ enrollmentId: PAQUETE })
    )
  })
})
