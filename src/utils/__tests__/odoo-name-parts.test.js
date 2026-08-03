import { describe, it, expect } from 'vitest'
import { buildOdooNameParts } from '../fico-odoo.helper.js'

describe('buildOdooNameParts', () => {
  it('parte el nombre como lo espera la ficha de Estudiante de Odoo', () => {
    expect(buildOdooNameParts({
      firstName: 'Rosa Valeria',
      lastName: 'Ushuñahua',
      motherLastName: 'Ricra'
    })).toEqual({ names: 'ROSA VALERIA', surnames: 'USHUÑAHUA RICRA' })
  })

  it('sin apellido materno no deja espacio colgando', () => {
    expect(buildOdooNameParts({ firstName: '  frank  rolando ', lastName: 'Albujar Canova' }))
      .toEqual({ names: 'FRANK ROLANDO', surnames: 'ALBUJAR CANOVA' })
  })

  it('sin datos devuelve vacios (el cliente los descarta, nunca borra en Odoo)', () => {
    expect(buildOdooNameParts({})).toEqual({ names: '', surnames: '' })
    expect(buildOdooNameParts()).toEqual({ names: '', surnames: '' })
  })
})
