import { describe, it, expect } from 'vitest'
import { buildConfirmationSubject, renderConfirmationEmail } from '../email-confirmation.render.js'

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

// El correo de evento (Fundacion) omitia el cronograma de cuotas: el asistente
// no sabia cuando ni cuanto le tocaba pagar. La regla es la misma que en la
// plantilla de curso: al contado no hay tabla, en cuotas si.
describe('renderConfirmationEmail — cronograma en el correo de evento', () => {
  const eventoBase = {
    program_name: 'CONGRESO INTERNACIONAL',
    program_type_alias: 'we_program_type_event',
    currency_symbol: 'S/.'
  }

  const render = (data, instRows) => renderConfirmationEmail({
    data, firstName: 'Ana', lastName: 'Perez', odooEmail: 'ana@we.pe',
    isNew: true, frequency: '', schedule: '', instRows, sapCredentials: null,
    isOnline: false, isParentProgram: false
  }).html

  it('lista fecha y monto de cada cuota', () => {
    const html = render(
      { ...eventoBase, payment_plan_alias: 'we_payment_way_installments' },
      [{ due_date: '2026-06-26', amount: 400 }, { due_date: '2026-07-26', amount: 350 }]
    )
    expect(html).toContain('Fecha de Pago')
    expect(html).toContain('26 Junio')
    expect(html).toContain('S/. 400')
    expect(html).toContain('26 Julio')
    expect(html).toContain('S/. 350')
  })

  it('no muestra la tabla si el pago es al contado', () => {
    const html = render(
      { ...eventoBase, payment_plan_alias: 'we_payment_way_single' },
      [{ due_date: '2026-06-26', amount: 400 }]
    )
    expect(html).not.toContain('Fecha de Pago')
  })
})
