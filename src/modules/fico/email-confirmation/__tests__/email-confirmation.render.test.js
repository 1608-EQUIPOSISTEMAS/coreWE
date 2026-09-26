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

// Un padre no tiene horario unico (cada modulo trae el suyo en el PDF) y su
// start_date puede faltar o no coincidir con el del primer modulo. Si esto se
// cae, el alumno del padre vuelve a recibir "Horario: ( GMT-5)" vacio.
describe('renderConfirmationEmail — inicio y horario de padre vs hijo', () => {
  const curso = { program_name: 'ESP. EN LOGISTICA', start_date: '2026-08-15', currency_symbol: 'S/.' }

  const render = ({ isParentProgram, firstModuleStartDate = null, data = curso }) => renderConfirmationEmail({
    data, firstName: 'Ana', lastName: 'Perez', odooEmail: 'ana@we.pe',
    isNew: true, frequency: 'Sabados', schedule: '9AM - 12PM', firstModuleStartDate,
    instRows: [], sapCredentials: null, isOnline: false, isParentProgram
  }).html

  it('el hijo muestra su horario y su propia fecha', () => {
    const html = render({ isParentProgram: false, firstModuleStartDate: '2026-08-29' })
    expect(html).toContain('Horario:')
    expect(html).toContain('9AM - 12PM')
    expect(html).toContain('15 de Agosto 2026')
  })

  it('el padre oculta el horario y arranca con el primer modulo', () => {
    const html = render({ isParentProgram: true, firstModuleStartDate: '2026-08-29' })
    expect(html).not.toContain('Horario:')
    expect(html).toContain('29 de Agosto 2026')
    expect(html).not.toContain('15 de Agosto 2026')
  })

  it('padre sin modulos en el arbol cae a su propia fecha', () => {
    expect(render({ isParentProgram: true })).toContain('15 de Agosto 2026')
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

// La Feria Laboral no usa el correo de congreso: sin RECUERDA ni formularios, y
// la entrada VIP suma sus beneficios en Consideraciones. Si esto se cae, el
// asistente recibe los botones de certificado y tarjeta que la feria no tiene.
describe('renderConfirmationEmail — correo de la Feria Laboral', () => {
  const render = (data) => renderConfirmationEmail({
    data, firstName: 'Ana', lastName: 'Perez', odooEmail: 'ana@we.pe',
    isNew: true, frequency: '', schedule: '', instRows: [], sapCredentials: null,
    isOnline: false, isParentProgram: false
  }).html

  const feria = {
    program_name: 'VIII FERIA LABORAL VIRTUAL',
    cat_event_category: 5070,
    event_category_alias: 'we_event_category_general',
    event_category_label: 'GENERAL',
    session_detail_virtual: 'Día 1: Jueves, 29 de Octubre de 4:00 PM. a 8:30 PM.\nDía 2: Viernes, 30 de Octubre',
    event_whatsapp_link: 'bit.ly/GrupoFeriaLab',
    certificate_form_link: 'https://forms.gle/CERT',
    currency_symbol: 'S/.'
  }

  it('GENERAL: agradece la participacion, resalta los dias y lleva el grupo de WhatsApp', () => {
    const html = render(feria)
    expect(html).toContain('Gracias por participar en la VIII FERIA LABORAL VIRTUAL')
    expect(html).toContain('ENTRADA GENERAL')
    expect(html).toContain('<b>Día 1:</b> Jueves')
    expect(html).toContain('https://bit.ly/GrupoFeriaLab')
    expect(html).not.toContain('beneficios de la modalidad VIP')
  })

  it('no hereda RECUERDA ni el formulario de certificado del congreso', () => {
    const html = render(feria)
    expect(html).not.toContain('RECUERDA')
    expect(html).not.toContain('https://forms.gle/CERT')
  })

  it('VIP: suma beneficios y certificado a las consideraciones', () => {
    const html = render({ ...feria, event_category_alias: 'we_event_category_vip', event_category_label: 'VIP', event_whatsapp_link: null })
    expect(html).toContain('ENTRADA VIP')
    expect(html).toContain('Los beneficios de la modalidad VIP se aplicarán post evento.')
    expect(html).toContain('Los certificados de participación se enviarán al correo de registro.')
    expect(html).not.toContain('WHATSAPP')
  })

  it('un congreso sigue con su plantilla', () => {
    expect(render({ ...feria, program_name: 'V CONGRESO DE DIRECCIÓN' })).toContain('RECUERDA')
  })
})
