import { describe, it, expect } from 'vitest'
import { buildConfirmacionHTML } from '../../src/templates/confirmacion-inscripcion.js'
import { buildConfirmacionOnlineHTML } from '../../src/templates/confirmacion-online.js'
import { buildMembresiaHTML } from '../../src/templates/bienvenida-membresia.js'
import { buildConfirmacionEventoHTML } from '../../src/templates/confirmacion-evento.js'

// Snapshots dorados de los correos que YA existen.
//
// Su unico proposito es proteger el refactor del despacho de plantillas
// (email-confirmation.render.js) y la extraccion del footer compartido: si
// cualquiera de esos cambios altera una coma del HTML actual, estos tests
// fallan. Se llaman a los builders directamente, con fixtures fijos y sin BD.
//
// IMPORTANTE: si un snapshot falla tras un refactor que deberia ser neutro, se
// arregla el codigo. NO se re-graba el snapshot.

// Fecha fija: formatDate() de las plantillas depende del valor, no del reloj,
// pero se deja explicita para que el snapshot no dependa del entorno.
const START_DATE = '2026-08-15'

const INSTALLMENTS = [
  { installment_number: 1, amount: 500, due_date: '2026-08-15' },
  { installment_number: 2, amount: 500, due_date: '2026-09-15' }
]

describe('templates/confirmacion-inscripcion', () => {
  it('alumno nuevo, con cuotas y WhatsApp visible', () => {
    const html = buildConfirmacionHTML({
      studentName: 'luis alberto',
      programName: 'DIPLOMADO EN GESTION DE OPERACIONES',
      startDate: START_DATE,
      frequency: 'Lunes, Miercoles',
      schedule: '19:00 - 22:00',
      whatsappLink: 'https://chat.whatsapp.com/FIXTURE',
      email: 'luis.alberto@weeducacion.edu.pe',
      isNew: true,
      bannerUrl: 'https://lh3.googleusercontent.com/d/FIXTUREBANNER',
      installments: INSTALLMENTS,
      currencySymbol: 'S/.',
      hideWhatsapp: false
    })
    expect(html).toMatchSnapshot()
  })

  // Programa padre: sin cuotas y con el bloque de WhatsApp oculto.
  it('alumno recurrente, sin cuotas y con WhatsApp oculto', () => {
    const html = buildConfirmacionHTML({
      studentName: 'maria',
      programName: 'ESP. EN LOGISTICA INTEGRAL',
      startDate: START_DATE,
      frequency: 'Sabados',
      schedule: '09:00 - 13:00',
      whatsappLink: 'https://chat.whatsapp.com/FIXTURE',
      email: 'maria.perez@weeducacion.edu.pe',
      isNew: false,
      bannerUrl: '',
      installments: [],
      currencySymbol: 'S/.',
      hideWhatsapp: true
    })
    expect(html).toMatchSnapshot()
  })
})

describe('templates/confirmacion-online', () => {
  it('sin credenciales SAP', () => {
    const html = buildConfirmacionOnlineHTML({
      studentName: 'jose',
      programName: 'CURSO ONLINE DE EXCEL',
      email: 'jose.ramos@weeducacion.edu.pe',
      isNew: true,
      sapUser: null,
      sapPassword: null
    })
    expect(html).toMatchSnapshot()
  })

  it('con credenciales SAP', () => {
    const html = buildConfirmacionOnlineHTML({
      studentName: 'jose',
      programName: 'SAP MM ONLINE',
      email: 'jose.ramos@weeducacion.edu.pe',
      isNew: false,
      sapUser: 'FIXTUREUSER',
      sapPassword: 'FIXTUREPASS'
    })
    expect(html).toMatchSnapshot()
  })
})

describe('templates/bienvenida-membresia', () => {
  it('membresia GOLD', () => {
    const html = buildMembresiaHTML({
      studentName: 'ana lucia',
      programName: 'WE GOLD',
      email: 'ana.torres@weeducacion.edu.pe',
      password: '1234567',
      isNew: true,
      duracion: '6 meses',
      fechaActivacion: '15/08/2026',
      fechaRenovacion: '15/02/2027',
      installmentsHTML: '',
      bloqueBeneficios: undefined,
      fichaRegistroLink: undefined
    })
    expect(html).toMatchSnapshot()
  })
})

describe('templates/confirmacion-evento', () => {
  it('entrada VIRTUAL con los tres botones', () => {
    const html = buildConfirmacionEventoHTML({
      studentName: 'luis',
      eventName: 'XXVI Congreso de Logistica: Tecnologia, Resiliencia y Sostenibilidad Global - Virtual',
      categoryLabel: 'VIRTUAL',
      sessionDetail: 'Dia 1: Viernes 19 de Junio de 5pm a 9:20pm - Via Zoom (Hora Peru)\nDia 2: Sabado 20 de Junio de 9am a 1pm - Via Zoom (Hora Peru)',
      bannerUrl: 'https://api.we-educacion.com/uploads/FIXTURE.jpg',
      whatsappLink: 'https://chat.whatsapp.com/FIXTURE',
      certificateFormLink: 'https://forms.gle/FIXTURECERT',
      businessCardLink: 'https://forms.gle/FIXTURECARD'
    })
    expect(html).toMatchSnapshot()
  })

  // Sin banner y sin links: los bloques deben DESAPARECER, no quedar vacios.
  it('entrada presencial sin banner ni links', () => {
    const html = buildConfirmacionEventoHTML({
      studentName: 'ana',
      eventName: 'XXVI Congreso de Logistica',
      categoryLabel: 'VIP',
      sessionDetail: 'Dia 1: Viernes 19 de Junio - Hotel Marriott, Miraflores',
      bannerUrl: '',
      whatsappLink: '',
      certificateFormLink: '',
      businessCardLink: ''
    })
    expect(html).not.toContain('href=""')
    expect(html).not.toContain('<img src="">')
    expect(html).toMatchSnapshot()
  })

  // Los links de grupo se cargan a mano y llegan sin esquema: 'bit.ly/PROYECVIP'
  // sin https es un enlace relativo y el boton no lleva a ningun lado.
  it('completa el esquema del link de whatsapp cargado sin http', () => {
    const html = buildConfirmacionEventoHTML({
      studentName: 'ana',
      eventName: 'V Congreso',
      categoryLabel: 'VIP',
      whatsappLink: 'bit.ly/PROYECVIP',
      certificateFormLink: 'https://bit.ly/FichaCert'
    })
    expect(html).toContain('href="https://bit.ly/PROYECVIP"')
    expect(html).toContain('href="https://bit.ly/FichaCert"')
  })

  // Cada entrada VIP tiene su asiento: es lo que la persona busca al llegar.
  it('entrada VIP con asiento asignado', () => {
    const html = buildConfirmacionEventoHTML({
      studentName: 'ana',
      eventName: 'V Congreso de Direccion de Proyectos',
      categoryLabel: 'VIP',
      sessionDetail: 'Dia 1: Viernes 5 de Setiembre - Hotel Marriott, Miraflores',
      bannerUrl: '',
      whatsappLink: 'https://chat.whatsapp.com/FIXTUREVIP',
      certificateFormLink: '',
      businessCardLink: '',
      seat: 'A-12'
    })
    expect(html).toMatchSnapshot()
  })

  // El asiento lo tipea un operador y va directo al HTML de un correo.
  it('escapa el asiento', () => {
    const html = buildConfirmacionEventoHTML({
      studentName: 'test',
      eventName: 'Evento',
      categoryLabel: 'VIP',
      sessionDetail: '',
      bannerUrl: '', whatsappLink: '', certificateFormLink: '', businessCardLink: '',
      seat: '<script>alert(1)</script>'
    })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapa el texto libre del detalle de sesiones', () => {
    const html = buildConfirmacionEventoHTML({
      studentName: 'test',
      eventName: 'Evento',
      categoryLabel: 'GENERAL',
      sessionDetail: '<script>alert(1)</script>',
      bannerUrl: '', whatsappLink: '', certificateFormLink: '', businessCardLink: ''
    })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
