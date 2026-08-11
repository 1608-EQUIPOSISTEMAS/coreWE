import { describe, it, expect, vi, beforeEach } from 'vitest'

// El endpoint de links del aula existe para que Academica no necesite el rol
// ADMIN/PRODUCTO que exige sp_edition_update. A cambio, el SET del UPDATE se
// arma con lo que llegue: la whitelist del usecase es la unica defensa.
const repo = { updateEditionColumns: vi.fn(async () => 1) }
vi.mock('../../src/modules/edition/edition.repository.js', () => ({ editionRepository: repo }))
vi.mock('../../src/config/odooClient.js', () => ({ default: {} }))

const { classroomLinksSave } = await import('../../src/modules/edition/edition.usecases.js')

beforeEach(() => repo.updateEditionColumns.mockClear())

const camposEnviados = () => repo.updateEditionColumns.mock.calls[0][1]

describe('classroomLinksSave', () => {
  it('escribe los cuatro links', async () => {
    await classroomLinksSave({
      edition_num_id: 7,
      whatsapp_link: 'https://chat.whatsapp.com/X',
      teams_link: 'https://teams.microsoft.com/X',
      ficha_link: 'https://drive/ficha',
      grades_link: 'https://docs/notas'
    })
    expect(repo.updateEditionColumns.mock.calls[0][0]).toBe(7)
    expect(Object.keys(camposEnviados())).toEqual(['whatsapp_link', 'teams_link', 'ficha_link', 'grades_link'])
  })

  it('ignora cualquier columna fuera de la lista', async () => {
    await classroomLinksSave({ edition_num_id: 7, ficha_link: 'https://x', vacant: 999, notes: 'hola' })
    expect(camposEnviados()).toEqual({ ficha_link: 'https://x' })
  })

  it('no toca los links que no vienen en el payload', async () => {
    await classroomLinksSave({ edition_num_id: 7, teams_link: 'https://x' })
    expect(camposEnviados()).toEqual({ teams_link: 'https://x' })
  })

  it('convierte vacio a NULL para poder borrar un link', async () => {
    await classroomLinksSave({ edition_num_id: 7, grades_link: '   ' })
    expect(camposEnviados()).toEqual({ grades_link: null })
  })

  it('exige edition_num_id en vez de actualizar a ciegas', async () => {
    await expect(classroomLinksSave({ ficha_link: 'https://x' })).rejects.toThrow()
    expect(repo.updateEditionColumns).not.toHaveBeenCalled()
  })
})
