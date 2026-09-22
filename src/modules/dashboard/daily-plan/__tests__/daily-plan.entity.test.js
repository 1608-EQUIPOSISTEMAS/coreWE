import { describe, it, expect } from 'vitest'
import {
  scoreLead, pickPlanLeads, waPhone, businessDays, advisorMonth, advisorFacts,
  buildWhatsappMessages, cleanModelText, mentionsMoney, primerNombre, fallbackFocus,
  STATUS, RESULT, INTEREST_ALTO, PLAN_LIMIT
} from '../daily-plan.entity.js'

const HOY = new Date(2026, 8, 18, 6, 30) // viernes 18-sep-2026
const hace = (dias) => new Date(2026, 8, 18 - dias, 10)
const lead = (over = {}) => ({
  lead_id: 1,
  full_name: 'MARIA LOPEZ',
  programa: 'POWER BI',
  registration_date: hace(10),
  cat_status_lead: 2362, // Atendido
  cat_interest_level: 2371, // Bajo
  ult_result: null,
  ult_result_label: null,
  ult_fecha: null,
  agenda_hora: null,
  origin_phone: '987654321',
  country_code: '+51',
  ...over
})

describe('scoreLead', () => {
  it('la llamada agendada hoy va primero y muestra la hora', () => {
    const s = scoreLead(lead({ agenda_hora: '10:30' }), HOY)
    expect(s.tipo).toBe('agenda')
    expect(s.score).toBe(100)
    expect(s.motivo).toContain('10:30')
  })

  it('"Pagará" o "Voy a pagar" = confirmar pago', () => {
    expect(scoreLead(lead({ cat_status_lead: STATUS.PAGARA }), HOY).tipo).toBe('pago')
    expect(scoreLead(lead({ ult_result: RESULT.VOY_A_PAGAR, ult_fecha: hace(1) }), HOY).tipo).toBe('pago')
  })

  it('consulta nueva sin contacto solo hasta 3 dias', () => {
    expect(scoreLead(lead({ registration_date: hace(0) }), HOY).motivo).toBe('Consulta de hoy, aún sin contactar')
    expect(scoreLead(lead({ registration_date: hace(3) }), HOY).tipo).toBe('nuevo')
    expect(scoreLead(lead({ registration_date: hace(4) }), HOY)).toBeNull()
  })

  it('descarta resultados sin salida y estados cerrados', () => {
    expect(scoreLead(lead({ agenda_hora: '10:00', ult_result: 4100 }), HOY)).toBeNull() // no le interesa
    expect(scoreLead(lead({ cat_status_lead: 2366, cat_interest_level: INTEREST_ALTO }), HOY)).toBeNull() // pagó
  })

  it('suma urgencia si lleva 4+ dias sin contacto', () => {
    const s = scoreLead(lead({ ult_result: RESULT.REVISARA_INFO, ult_result_label: 'Revisará nuevamente info', ult_fecha: hace(6) }), HOY)
    expect(s.score).toBe(55 + 8)
    expect(s.motivo).toContain('lleva 6 días sin contacto')
  })

  it('si ya se le hablo hoy baja de prioridad', () => {
    const s = scoreLead(lead({ ult_result: RESULT.MUESTRA_INTERES, ult_result_label: 'Muestra interés', ult_fecha: hace(0) }), HOY)
    expect(s.score).toBe(75 - 30)
  })

  it('la objecion de precio sugiere cuotas', () => {
    const s = scoreLead(lead({ ult_result: RESULT.MUY_CARO, ult_result_label: 'Muy caro', ult_fecha: hace(1) }), HOY)
    expect(s.tipo).toBe('precio')
    expect(s.motivo).toContain('cuotas')
  })

  it('un lead sin ninguna señal no entra', () => {
    expect(scoreLead(lead(), HOY)).toBeNull()
  })
})

describe('pickPlanLeads', () => {
  it('ordena por prioridad, corta en el limite y cuenta los candidatos', () => {
    const leads = [
      lead({ lead_id: 1, cat_interest_level: INTEREST_ALTO }),
      lead({ lead_id: 2, agenda_hora: '09:00' }),
      lead({ lead_id: 3 }), // sin señal
      ...Array.from({ length: 6 }, (_, i) => lead({ lead_id: 10 + i, cat_status_lead: STATUS.INTERESADO }))
    ]
    const plan = pickPlanLeads(leads, HOY)
    expect(plan.candidatos).toBe(8)
    expect(plan.leads).toHaveLength(PLAN_LIMIT)
    expect(plan.leads[0].lead_id).toBe(2)
    expect(plan.leads[1].lead_id).toBe(15) // empate: el mas reciente
    expect(plan.leads[0].telefono).toBe('51987654321')
    expect(plan.leads[0].whatsapp).toBeNull()
  })
})

describe('waPhone', () => {
  it('antepone el codigo de pais una sola vez', () => {
    expect(waPhone('987654321', '+51')).toBe('51987654321')
    expect(waPhone('51987654321', '+51')).toBe('51987654321')
    expect(waPhone('', '+51')).toBeNull()
    expect(waPhone('987654321', null)).toBe('987654321')
  })
})

describe('cifras del mes', () => {
  it('cuenta dias habiles del mes', () => {
    expect(businessDays(HOY)).toEqual({ total: 22, transcurridos: 14 })
  })

  it('prorratea la meta y pone el tono', () => {
    const mes = advisorMonth({ mes: 5, meta: 22, consultas: 40, sin_gestion: 3, mes_prev_tramo: 7 }, { consultas: 20, en_24h: 15 }, HOY)
    expect(mes.esperado).toBe(14)
    expect(mes.tono).toBe('bad')
    expect(mes.contacto_24h_pct).toBe(75)
  })

  it('sin meta el tono es neutro', () => {
    expect(advisorMonth({ mes: 3, meta: null }, null, HOY).tono).toBe('neutro')
    expect(advisorMonth(undefined, null, HOY).ventas).toBe(0)
  })

  it('los hechos para el modelo solo llevan cifras calculadas', () => {
    const mes = advisorMonth({ mes: 5, meta: 22, sin_gestion: 3 }, null, HOY)
    const plan = pickPlanLeads([lead({ agenda_hora: '09:00' })], HOY)
    const facts = advisorFacts('JUAN PEREZ', mes, plan)
    expect(facts).toContain('Asesor: Juan')
    expect(facts).toContain('5 de una meta de 22')
    expect(facts).toContain('1 con llamada agendada')
    expect(fallbackFocus('JUAN PEREZ', mes, plan)).toBe('Juan: 5 de 22 ventas del mes (a la fecha tocaban 14), 3 consultas sin gestión, 1 consultas priorizadas para hoy.')
  })
})

describe('redaccion', () => {
  it('el prompt de WhatsApp lleva el objetivo segun el tipo y un ejemplo', () => {
    const msgs = buildWhatsappMessages({ nombre: 'MARIA LOPEZ', programa: null, tipo: 'precio' })
    expect(msgs).toHaveLength(4)
    expect(msgs[3].content).toContain('Nombre: Maria')
    expect(msgs[3].content).toContain('(sin programa registrado)')
    expect(msgs[3].content).toContain('cuotas')
  })

  it('limpia prefijos y comillas del modelo', () => {
    expect(cleanModelText('Mensaje: "Hola Ana"')).toBe('Hola Ana')
    expect(cleanModelText('  Hola  ')).toBe('Hola')
  })

  it('detecta montos inventados', () => {
    expect(mentionsMoney('cuesta S/ 1200')).toBe(true)
    expect(mentionsMoney('con 20% de descuento')).toBe(true)
    expect(mentionsMoney('¿Pudo revisar la información?')).toBe(false)
  })

  it('primer nombre capitalizado', () => {
    expect(primerNombre('  ROSA maria  ')).toBe('Rosa')
    expect(primerNombre(null)).toBe('')
  })
})

describe('cleanModelText (parrafos)', () => {
  it('junta los parrafos en uno solo', () => {
    expect(cleanModelText('Primera oración.\n\nSegunda oración.')).toBe('Primera oración. Segunda oración.')
  })
})

describe('borrador de WhatsApp: casos reales', () => {
  it('SAP S/4 HANA no cuenta como monto; S/ 500 sí', () => {
    expect(mentionsMoney('Sobre el programa SAP S/4 HANA IN, ¿tiene dudas?')).toBe(false)
    expect(mentionsMoney('SAP S/4HANA cuesta S/ 500')).toBe(true)
  })

  it('lead sin nombre: se le dice al modelo que no lo hay', () => {
    const msgs = buildWhatsappMessages({ nombre: '-', programa: 'POWER BI', tipo: 'pago' })
    expect(msgs.at(-1).content).toContain('Nombre: (no registrado)')
    expect(buildWhatsappMessages({ nombre: 'ANA TORRES', tipo: 'pago' }).at(-1).content).toContain('Nombre: Ana')
  })
})
