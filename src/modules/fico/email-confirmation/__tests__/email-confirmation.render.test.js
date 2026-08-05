import { describe, it, expect } from 'vitest'
import { buildConfirmationSubject } from '../email-confirmation.render.js'

// El asunto se arma en preview y en send: si el helper deja de distinguir la
// modalidad, los tres tipos de entrada llegan con el mismo asunto y el
// asistente no sabe cual compro hasta abrir el correo.
describe('buildConfirmationSubject', () => {
  const evento = { program_name: 'V CONGRESO DE DIRECCIÓN', cat_event_category: 5069 }

  it('agrega la modalidad en un evento', () => {
    expect(buildConfirmationSubject({ ...evento, event_category_label: 'VIP' }))
      .toBe('Confirmacion de Inscripcion - V CONGRESO DE DIRECCIÓN - ENTRADA VIP')
  })

  it('no inventa modalidad si la inscripcion no la tiene cargada', () => {
    expect(buildConfirmationSubject({ program_name: 'V CONGRESO DE DIRECCIÓN' }))
      .toBe('Confirmacion de Inscripcion - V CONGRESO DE DIRECCIÓN')
  })

  it('un curso normal no lleva modalidad aunque traiga etiqueta suelta', () => {
    expect(buildConfirmationSubject({ program_name: 'EXCEL AVANZADO', event_category_label: 'VIP' }))
      .toBe('Confirmacion de Inscripcion - EXCEL AVANZADO')
  })
})
