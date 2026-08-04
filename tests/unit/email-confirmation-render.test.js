import { describe, it, expect } from 'vitest'
import {
  resolveConfirmationTemplate,
  renderConfirmationEmail
} from '../../src/modules/fico/email-confirmation/email-confirmation.render.js'

// Decision de plantilla. Es la unica logica de negocio del modulo de render y
// la que antes vivia duplicada entre preview y send.

const BASE = {
  program_name: 'PROGRAMA',
  banner_link: '',
  whatsapp_link: '',
  start_date: '2026-08-15',
  currency_symbol: 'S/.',
  payment_plan_alias: 'we_payment_way_single'
}

const CTX = {
  firstName: 'Luis',
  lastName: 'Ramos',
  odooEmail: 'luis.ramos@weeducacion.edu.pe',
  isNew: true,
  frequency: 'Lunes',
  schedule: '19:00 - 22:00',
  instRows: [],
  sapCredentials: null,
  isOnline: false,
  isParentProgram: false
}

describe('resolveConfirmationTemplate', () => {
  it('detecta evento por cat_event_category', () => {
    const r = resolveConfirmationTemplate({ cat_event_category: 5100 })
    expect(r.isEvent).toBe(true)
  })

  it('detecta evento por alias del tipo de programa', () => {
    const r = resolveConfirmationTemplate({ program_type_alias: 'we_program_type_event' })
    expect(r.isEvent).toBe(true)
  })

  it('un curso normal no es evento', () => {
    const r = resolveConfirmationTemplate({
      cat_event_category: null,
      program_type_alias: 'we_program_type_course'
    })
    expect(r.isEvent).toBe(false)
  })

  it('marca la entrada VIRTUAL', () => {
    expect(resolveConfirmationTemplate({
      cat_event_category: 5100,
      event_category_alias: 'we_event_category_virtual'
    }).isVirtualTicket).toBe(true)

    expect(resolveConfirmationTemplate({
      cat_event_category: 5101,
      event_category_alias: 'we_event_category_vip'
    }).isVirtualTicket).toBe(false)
  })
})

describe('renderConfirmationEmail', () => {
  it('evento gana sobre online', () => {
    const { kind } = renderConfirmationEmail({
      ...CTX,
      isOnline: true,
      data: { ...BASE, cat_event_category: 5100, event_category_alias: 'we_event_category_virtual' }
    })
    expect(kind).toBe('evento')
  })

  it('VIRTUAL usa session_detail_virtual', () => {
    const { html } = renderConfirmationEmail({
      ...CTX,
      data: {
        ...BASE,
        cat_event_category: 5100,
        event_category_alias: 'we_event_category_virtual',
        session_detail_virtual: 'DETALLE VIRTUAL',
        session_detail_onsite: 'DETALLE PRESENCIAL'
      }
    })
    expect(html).toContain('DETALLE VIRTUAL')
    expect(html).not.toContain('DETALLE PRESENCIAL')
  })

  it('VIP usa session_detail_onsite', () => {
    const { html } = renderConfirmationEmail({
      ...CTX,
      data: {
        ...BASE,
        cat_event_category: 5101,
        event_category_alias: 'we_event_category_vip',
        session_detail_virtual: 'DETALLE VIRTUAL',
        session_detail_onsite: 'DETALLE PRESENCIAL'
      }
    })
    expect(html).toContain('DETALLE PRESENCIAL')
    expect(html).not.toContain('DETALLE VIRTUAL')
  })

  // Fallback cruzado: mejor un detalle aproximado que un correo sin ninguna
  // indicacion de cuando y donde es el evento.
  it('cae al otro detalle si el suyo esta vacio', () => {
    const { html } = renderConfirmationEmail({
      ...CTX,
      data: {
        ...BASE,
        cat_event_category: 5100,
        event_category_alias: 'we_event_category_virtual',
        session_detail_virtual: '   ',
        session_detail_onsite: 'SOLO PRESENCIAL CARGADO'
      }
    })
    expect(html).toContain('SOLO PRESENCIAL CARGADO')
  })

  // Cada categoria tiene su grupo: el VIP no debe recibir el de los VIRTUAL.
  it('prefiere el WhatsApp de la categoria sobre el de la edicion', () => {
    const { html } = renderConfirmationEmail({
      ...CTX,
      data: {
        ...BASE,
        cat_event_category: 5103,
        event_category_alias: 'we_event_category_vip',
        whatsapp_link: 'https://chat.whatsapp.com/EDICION',
        event_whatsapp_link: 'https://chat.whatsapp.com/VIP'
      }
    })
    expect(html).toContain('https://chat.whatsapp.com/VIP')
    expect(html).not.toContain('https://chat.whatsapp.com/EDICION')
  })

  // Eventos configurados antes de que existiera el link por categoria.
  it('cae al WhatsApp de la edicion si la categoria no tiene', () => {
    const { html } = renderConfirmationEmail({
      ...CTX,
      data: {
        ...BASE,
        cat_event_category: 5103,
        event_category_alias: 'we_event_category_vip',
        whatsapp_link: 'https://chat.whatsapp.com/EDICION',
        event_whatsapp_link: null
      }
    })
    expect(html).toContain('https://chat.whatsapp.com/EDICION')
  })

  // La categoria sale en TODOS los correos de evento, no solo en los VIP.
  it('muestra la categoria en las cuatro entradas', () => {
    for (const label of ['VIP', 'GENERAL', 'PREMIUM', 'VIRTUAL']) {
      const { html } = renderConfirmationEmail({
        ...CTX,
        data: {
          ...BASE,
          cat_event_category: 5100,
          event_category_alias: `we_event_category_${label.toLowerCase()}`,
          event_category_label: label
        }
      })
      expect(html).toContain(`ENTRADA ${label}`)
    }
  })

  // El asiento es propio de la entrada VIP. Si esto se cae, o el VIP llega a la
  // sala sin saber donde sentarse, o una entrada GENERAL muestra un asiento
  // que nadie le asigno.
  it('muestra el asiento en la entrada VIP', () => {
    const { html } = renderConfirmationEmail({
      ...CTX,
      data: {
        ...BASE,
        cat_event_category: 5103,
        event_category_alias: 'we_event_category_vip',
        event_seat: 'A-12'
      }
    })
    expect(html).toContain('TU ASIENTO')
    expect(html).toContain('A-12')
  })

  it('no lo muestra fuera de VIP aunque el dato exista', () => {
    const { html } = renderConfirmationEmail({
      ...CTX,
      data: {
        ...BASE,
        cat_event_category: 5100,
        event_category_alias: 'we_event_category_general',
        event_seat: 'A-12'
      }
    })
    expect(html).not.toContain('TU ASIENTO')
    expect(html).not.toContain('A-12')
  })

  it('sin asiento no emite el bloque', () => {
    const { html } = renderConfirmationEmail({
      ...CTX,
      data: {
        ...BASE,
        cat_event_category: 5103,
        event_category_alias: 'we_event_category_vip',
        event_seat: null
      }
    })
    expect(html).not.toContain('TU ASIENTO')
  })

  it('online sin evento usa la plantilla online', () => {
    const { kind } = renderConfirmationEmail({
      ...CTX,
      isOnline: true,
      data: { ...BASE, cat_event_category: null, program_type_alias: 'we_program_type_course' }
    })
    expect(kind).toBe('online')
  })

  it('curso presencial usa la plantilla de curso', () => {
    const { kind } = renderConfirmationEmail({
      ...CTX,
      data: { ...BASE, cat_event_category: null, program_type_alias: 'we_program_type_course' }
    })
    expect(kind).toBe('curso')
  })
})
