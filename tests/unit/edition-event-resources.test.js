import { describe, it, expect, vi, beforeEach } from 'vitest'

// El banner viaja en base64 dentro del JSON y se guarda como bytea. Estas
// guardas son lo unico que separa un correo sano de uno de 5 MB por asistente.
const repo = {
  updateEditionColumns: vi.fn(async () => 1),
  getEventResources: vi.fn(async () => null),
  getEventBannerImage: vi.fn(async () => null),
  listEventEditions: vi.fn(async () => []),
  programVersionOf: vi.fn(async () => 77),
  getEventCategories: vi.fn(async () => CATALOG_CATEGORIES),
  saveEventCategories: vi.fn(async () => 4)
}

// Las cuatro del catalogo. getEventCategories siempre las devuelve todas: la
// pantalla necesita ver las apagadas para poder encenderlas.
const CATALOG_CATEGORIES = [
  { cat_event_category: 5101, alias: 'we_event_category_general', description: 'GENERAL' },
  { cat_event_category: 5102, alias: 'we_event_category_premium', description: 'PREMIUM' },
  { cat_event_category: 5103, alias: 'we_event_category_vip', description: 'VIP' },
  { cat_event_category: 5104, alias: 'we_event_category_virtual', description: 'VIRTUAL' }
]

vi.mock('../../src/modules/edition/edition.repository.js', () => ({
  editionRepository: repo
}))

const { eventResourcesSave, eventEditionsList, eventCategoriesSave } =
  await import('../../src/modules/edition/edition.usecases.js')

beforeEach(() => {
  repo.updateEditionColumns.mockClear()
  repo.listEventEditions.mockClear()
  repo.saveEventCategories.mockClear()
  repo.listEventEditions.mockImplementation(async () => [])
})

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

describe('eventResourcesSave', () => {
  it('convierte el base64 a Buffer y guarda el mime', async () => {
    await eventResourcesSave({
      edition_num_id: 10,
      banner_image_base64: PNG_1PX,
      banner_mime: 'image/png'
    })
    const [, fields] = repo.updateEditionColumns.mock.calls[0]
    expect(Buffer.isBuffer(fields.banner_image)).toBe(true)
    expect(fields.banner_mime).toBe('image/png')
  })

  it('acepta el data URI completo, no solo el payload', async () => {
    await eventResourcesSave({
      edition_num_id: 10,
      banner_image_base64: `data:image/png;base64,${PNG_1PX}`,
      banner_mime: 'image/png'
    })
    const [, fields] = repo.updateEditionColumns.mock.calls[0]
    expect(fields.banner_image.length).toBeGreaterThan(0)
  })

  it('cadena vacia borra el banner', async () => {
    await eventResourcesSave({ edition_num_id: 10, banner_image_base64: '' })
    const [, fields] = repo.updateEditionColumns.mock.calls[0]
    expect(fields.banner_image).toBeNull()
    expect(fields.banner_mime).toBeNull()
  })

  // Sin la clave no se toca lo ya guardado: guardar los textos no debe borrar
  // el banner que se cargo en otra sesion.
  it('sin la clave no toca el banner existente', async () => {
    await eventResourcesSave({ edition_num_id: 10, session_detail_onsite: 'Sede X' })
    const [, fields] = repo.updateEditionColumns.mock.calls[0]
    expect(fields).not.toHaveProperty('banner_image')
    expect(fields.session_detail_onsite).toBe('Sede X')
  })

  it('rechaza un mime no permitido', async () => {
    await expect(eventResourcesSave({
      edition_num_id: 10, banner_image_base64: PNG_1PX, banner_mime: 'image/svg+xml'
    })).rejects.toThrow(/JPG o PNG/)
  })

  it('acepta un banner de 2 MB', async () => {
    const ok = Buffer.alloc(2 * 1024 * 1024).toString('base64')
    await eventResourcesSave({
      edition_num_id: 10, banner_image_base64: ok, banner_mime: 'image/jpeg'
    })
    expect(repo.updateEditionColumns).toHaveBeenCalled()
  })

  it('rechaza un banner de mas de 2 MB', async () => {
    const big = Buffer.alloc(2 * 1024 * 1024 + 10).toString('base64')
    await expect(eventResourcesSave({
      edition_num_id: 10, banner_image_base64: big, banner_mime: 'image/jpeg'
    })).rejects.toThrow(/2 MB/)
  })

  it('normaliza cadenas vacias a null en los links', async () => {
    await eventResourcesSave({ edition_num_id: 10, certificate_form_link: '   ' })
    const [, fields] = repo.updateEditionColumns.mock.calls[0]
    expect(fields.certificate_form_link).toBeNull()
  })

  it('sin edition_num_id no escribe nada', async () => {
    const res = await eventResourcesSave({ banner_image_base64: PNG_1PX, banner_mime: 'image/png' })
    expect(res).toEqual({ updated: 0 })
    expect(repo.updateEditionColumns).not.toHaveBeenCalled()
  })
})

// No todos los congresos venden las cuatro categorias, y cada una tiene su
// propio grupo de WhatsApp.
describe('eventCategoriesSave', () => {
  const base = { cat_event_category: 5103, enabled: true, price_student_soles: 1200 }

  it('guarda contra la version del programa, no contra la edicion', async () => {
    await eventCategoriesSave({ edition_num_id: 10, categories: [base] })
    const [versionId] = repo.saveEventCategories.mock.calls[0]
    expect(versionId).toBe(77)
  })

  it('normaliza el link vacio a null y los precios ausentes a 0', async () => {
    await eventCategoriesSave({
      edition_num_id: 10,
      categories: [{ ...base, whatsapp_link: '   ', price_student_dollars: undefined }]
    })
    const [, list] = repo.saveEventCategories.mock.calls[0]
    expect(list[0].whatsapp_link).toBeNull()
    expect(list[0].price_student_dollars).toBe(0)
  })

  it('conserva el link de cada categoria por separado', async () => {
    await eventCategoriesSave({
      edition_num_id: 10,
      categories: [
        { cat_event_category: 5103, enabled: true, whatsapp_link: 'https://chat.whatsapp.com/VIP' },
        { cat_event_category: 5104, enabled: true, whatsapp_link: 'https://chat.whatsapp.com/VIRTUAL' }
      ]
    })
    const [, list] = repo.saveEventCategories.mock.calls[0]
    expect(list.map(c => c.whatsapp_link)).toEqual([
      'https://chat.whatsapp.com/VIP',
      'https://chat.whatsapp.com/VIRTUAL'
    ])
  })

  // El endpoint escribe filas indexadas por catalog_id: sin cotejar contra el
  // catalogo real, cualquier id del sistema entraria en la tabla de precios.
  it('descarta ids que no son categorias de entrada', async () => {
    await eventCategoriesSave({
      edition_num_id: 10,
      categories: [base, { cat_event_category: 999999, enabled: true }]
    })
    const [, list] = repo.saveEventCategories.mock.calls[0]
    expect(list).toHaveLength(1)
    expect(list[0].cat_event_category).toBe(5103)
  })

  // Cero categorias activas hace que el formulario de leads vuelva al fallback
  // de "las cuatro", que es justo lo contrario de lo que el usuario quiso.
  it('exige al menos una categoria activa', async () => {
    await expect(eventCategoriesSave({
      edition_num_id: 10,
      categories: [{ ...base, enabled: false }]
    })).rejects.toThrow(/al menos una/)
    expect(repo.saveEventCategories).not.toHaveBeenCalled()
  })
})

// Sin esta traduccion el 42703 se enmascara como "Error interno" en produccion
// y el modulo se ve igual que si no hubiera eventos creados.
describe('columnas de recursos ausentes', () => {
  it('traduce el 42703 de Postgres a un mensaje accionable', async () => {
    const pgErr = new Error('column pe.banner_image does not exist')
    pgErr.code = '42703'
    repo.listEventEditions.mockImplementation(async () => { throw pgErr })

    await expect(eventEditionsList({})).rejects.toThrow(/add-event-edition-resources\.sql/)
  })

  it('no disfraza otros errores de base de datos', async () => {
    const otro = new Error('connection terminated')
    otro.code = '57P01'
    repo.listEventEditions.mockImplementation(async () => { throw otro })

    await expect(eventEditionsList({})).rejects.toThrow(/connection terminated/)
  })
})
