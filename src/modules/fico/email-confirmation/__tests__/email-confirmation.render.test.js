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

  it('el ponente no compro entrada: el asunto dice PONENTE a secas', () => {
    expect(buildConfirmationSubject({
      ...evento,
      event_category_label: 'PONENTE',
      event_category_alias: 'we_event_category_ponente'
    })).toBe('Confirmacion de Inscripcion - V CONGRESO DE DIRECCIÓN - PONENTE')
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

// El ponente es invitado, no cliente: su correo no puede hablar de cuotas, de
// certificado con costo ni de formularios. Si esto se cae, el expositor recibe
// el correo de un asistente que pago entrada.
describe('renderConfirmationEmail — correo del ponente', () => {
  const render = (data) => renderConfirmationEmail({
    data, firstName: 'Ana', lastName: 'Perez', odooEmail: 'ana@we.pe',
    isNew: true, frequency: '', schedule: '', instRows: [], sapCredentials: null,
    isOnline: false, isParentProgram: false
  }).html

  const ponente = {
    program_name: 'V CONGRESO DE DIRECCIÓN',
    program_type_alias: 'we_program_type_event',
    cat_event_category: 5077,
    event_category_alias: 'we_event_category_ponente',
    event_category_label: 'PONENTE',
    certificate_form_link: 'https://forms.gle/CERT',
    whatsapp_link: 'https://chat.whatsapp.com/GRUPO',
    business_card_link: 'https://forms.gle/TARJETA',
    currency_symbol: 'S/.'
  }

  it('saluda por su nombre y muestra el badge PONENTE, no ENTRADA PONENTE', () => {
    const html = render(ponente)
    expect(html).toContain('¡Hola, Ana Perez!')
    expect(html).toContain('<strong>PONENTE</strong>')
    expect(html).not.toContain('ENTRADA PONENTE')
  })

  it('no lleva RECUERDA ni los tres botones aunque la edicion tenga los links', () => {
    const html = render(ponente)
    expect(html).not.toContain('RECUERDA')
    expect(html).not.toContain('https://forms.gle/CERT')
    expect(html).not.toContain('https://chat.whatsapp.com/GRUPO')
    expect(html).not.toContain('https://forms.gle/TARJETA')
  })

  it('se sienta en la zona VIP: si tiene asiento, sale', () => {
    expect(render({ ...ponente, event_seat: 'A-3' })).toContain('TU ASIENTO')
    expect(render(ponente)).not.toContain('TU ASIENTO')
  })

  it('el resto de las entradas conserva RECUERDA y sus botones', () => {
    const html = render({ ...ponente, event_category_alias: 'we_event_category_vip', event_category_label: 'VIP' })
    expect(html).toContain('ENTRADA VIP')
    expect(html).toContain('RECUERDA')
    expect(html).toContain('https://forms.gle/CERT')
  })
})
