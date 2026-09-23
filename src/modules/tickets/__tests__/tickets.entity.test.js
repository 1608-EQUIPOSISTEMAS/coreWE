import { describe, it, expect } from 'vitest'
import {
  ticketScopeFor, canRead, assertCanRead, assertCanManage, nextStatus, pickAgent,
  assertReassignable, validateTicketInput, validateComment,
  computeDueDates, formatTicketCode, withSla, applyFilter, buildKpis,
  canChangeStatusOf, canReopenOf, reopenByReporter
} from '../tickets.entity.js'

const AHORA = new Date('2026-01-01T12:00:00Z')

const ticket = (o = {}) => ({
  ticket_id: 1,
  status: 'ABIERTO',
  created_by_id: 10,
  assigned_to_id: 99,
  creador_roles: ['COMERCIAL'],
  registration_date: new Date('2026-01-01T10:00:00Z'),
  first_response_due_at: null,
  first_response_at: null,
  resolution_due_at: null,
  resolved_at: null,
  ...o
})

describe('ticketScopeFor', () => {
  it('ADMIN ve todo y gestiona', () => {
    expect(ticketScopeFor({ roles: ['ADMIN'], userId: 1 }))
      .toMatchObject({ kind: 'ALL', canManage: true, areaRoles: null })
  })

  it('GERENCIA ve todo pero no gestiona', () => {
    expect(ticketScopeFor({ roles: ['GERENCIA'], userId: 2 }))
      .toMatchObject({ kind: 'ALL', canManage: false })
  })

  it('un lider ve su area, derivada de AREA_OF_LEADER', () => {
    const scope = ticketScopeFor({ roles: ['LIDER_FICO'], userId: 3 })
    expect(scope.kind).toBe('AREA')
    expect(scope.areaRoles).toEqual(['FICO', 'LIDER_FICO'])
    expect(scope.canManage).toBe(false)
  })

  it('un lider de dos areas ve la union de ambas, sin repetidos', () => {
    const scope = ticketScopeFor({ roles: ['LIDER_FICO', 'LIDER_COMERCIAL'], userId: 3 })
    expect(scope.areaRoles).toEqual(['FICO', 'LIDER_FICO', 'COMERCIAL', 'LIDER_COMERCIAL'])
  })

  it('un colaborador solo ve lo suyo', () => {
    expect(ticketScopeFor({ roles: ['COMERCIAL'], userId: 4 }))
      .toMatchObject({ kind: 'OWN', userId: 4, canManage: false })
  })

  it('sin roles cae en OWN, no en ALL', () => {
    expect(ticketScopeFor({ roles: [], userId: 5 }).kind).toBe('OWN')
  })

  it('ADMIN gana aunque tenga tambien un rol de area', () => {
    expect(ticketScopeFor({ roles: ['LIDER_FICO', 'ADMIN'], userId: 6 }).canManage).toBe(true)
  })
})

describe('canRead', () => {
  const scopeAdmin = ticketScopeFor({ roles: ['ADMIN'], userId: 99 })
  const scopeLiderComercial = ticketScopeFor({ roles: ['LIDER_COMERCIAL'], userId: 50 })
  const scopeLiderFico = ticketScopeFor({ roles: ['LIDER_FICO'], userId: 51 })
  const scopeColaborador = ticketScopeFor({ roles: ['COMERCIAL'], userId: 77 })

  it('quien tiene alcance global abre cualquiera', () => {
    expect(canRead(ticket(), scopeAdmin, 99)).toBe(true)
  })

  it('el creador abre el suyo', () => {
    expect(canRead(ticket(), scopeColaborador, 10)).toBe(true)
  })

  it('el agente asignado lo abre aunque no sea de su area', () => {
    expect(canRead(ticket({ assigned_to_id: 77 }), scopeColaborador, 77)).toBe(true)
  })

  it('el lider abre los de su area', () => {
    expect(canRead(ticket({ creador_roles: ['COMERCIAL'] }), scopeLiderComercial, 50)).toBe(true)
  })

  it('el lider de OTRA area no lo abre', () => {
    expect(canRead(ticket({ creador_roles: ['COMERCIAL'] }), scopeLiderFico, 51)).toBe(false)
  })

  it('un colaborador ajeno no lo abre', () => {
    expect(canRead(ticket(), scopeColaborador, 77)).toBe(false)
    expect(() => assertCanRead(ticket(), scopeColaborador, 77)).toThrow(/permiso/i)
  })

  it('un ticket inexistente no se abre', () => {
    expect(canRead(null, scopeAdmin, 99)).toBe(false)
  })
})

describe('assertCanManage', () => {
  it('rechaza a quien no gestiona', () => {
    expect(() => assertCanManage(ticketScopeFor({ roles: ['GERENCIA'] }))).toThrow(/administrador/i)
  })
})

describe('canChangeStatusOf', () => {
  const admin = ticketScopeFor({ roles: ['ADMIN'], userId: 9 })
  const gerencia = ticketScopeFor({ roles: ['GERENCIA'], userId: 9 })

  it('el agente asignado puede moverlo', () => {
    expect(canChangeStatusOf({ status: 'EN_PROGRESO', assigned_to_id: 9 }, admin, 9)).toBe(true)
  })

  it('un ABIERTO sin dueño lo puede tomar cualquier agente', () => {
    expect(canChangeStatusOf({ status: 'ABIERTO', assigned_to_id: null }, admin, 9)).toBe(true)
  })

  it('no puede mover el ticket de otro agente', () => {
    expect(canChangeStatusOf({ status: 'ABIERTO', assigned_to_id: 3 }, admin, 9)).toBe(false)
  })

  it('quien no gestiona nunca puede', () => {
    expect(canChangeStatusOf({ status: 'ABIERTO', assigned_to_id: null }, gerencia, 9)).toBe(false)
  })
})

describe('reabrir desde quien reporto', () => {
  const cerrado = (o = {}) => ticket({ status: 'CERRADO', first_response_at: AHORA, resolved_at: AHORA, ...o })

  it('quien reporto puede reabrir su ticket resuelto', () => {
    expect(canReopenOf(cerrado(), 10)).toBe(true)
    expect(reopenByReporter(cerrado(), 10))
      .toEqual({ status: 'EN_PROGRESO', first_response_at: AHORA, resolved_at: null })
  })

  it('otro usuario no puede, aunque sea el agente asignado', () => {
    expect(canReopenOf(cerrado(), 99)).toBe(false)
    expect(() => reopenByReporter(cerrado(), 99)).toThrow(/Solo quien reportó/)
  })

  it('no se reabre un ticket que no esta resuelto', () => {
    expect(canReopenOf(ticket({ status: 'EN_PROGRESO' }), 10)).toBe(false)
    expect(() => reopenByReporter(ticket({ status: 'EN_PROGRESO' }), 10)).toThrow(/resuelto/)
  })
})

describe('nextStatus', () => {
  it('ABIERTO -> EN_PROGRESO sella la primera respuesta', () => {
    expect(nextStatus(ticket(), 99, 'EN_PROGRESO', AHORA))
      .toEqual({ status: 'EN_PROGRESO', first_response_at: AHORA })
  })

  it('EN_PROGRESO -> CERRADO sella la resolucion y conserva la respuesta', () => {
    const antes = new Date('2026-01-01T11:00:00Z')
    expect(nextStatus(ticket({ status: 'EN_PROGRESO', first_response_at: antes }), 99, 'CERRADO', AHORA))
      .toEqual({ status: 'CERRADO', first_response_at: antes, resolved_at: AHORA })
  })

  it('no pisa una primera respuesta ya sellada', () => {
    const antes = new Date('2026-01-01T11:00:00Z')
    expect(nextStatus(ticket({ first_response_at: antes }), 99, 'EN_PROGRESO', AHORA).first_response_at).toBe(antes)
  })

  it('no se salta pasos', () => {
    expect(() => nextStatus(ticket(), 99, 'CERRADO', AHORA)).toThrow(/ABIERTO a CERRADO/)
  })

  it('solo el agente asignado mueve el estado, ser ADMIN no alcanza', () => {
    expect(() => nextStatus(ticket({ assigned_to_id: 99 }), 42, 'EN_PROGRESO', AHORA)).toThrow(/permiso/i)
  })

  it('reabre un CERRADO a EN_PROGRESO y destraba la resolucion', () => {
    const primeraRespuesta = new Date('2026-01-01T11:00:00Z')
    const cerrado = ticket({ status: 'CERRADO', first_response_at: primeraRespuesta, resolved_at: new Date('2026-01-01T13:00:00Z') })
    expect(nextStatus(cerrado, 99, 'EN_PROGRESO', AHORA))
      .toEqual({ status: 'EN_PROGRESO', first_response_at: primeraRespuesta, resolved_at: null })
  })

  it('reabrir tambien exige ser el agente asignado', () => {
    expect(() => nextStatus(ticket({ status: 'CERRADO', assigned_to_id: 99 }), 42, 'EN_PROGRESO', AHORA)).toThrow(/permiso/i)
  })
})

describe('pickAgent', () => {
  const agente = (id, o = {}) => ({ user_id: id, carga_activa: 0, en_progreso: false, ultimo_asignado: null, ...o })

  it('sin candidatos devuelve null', () => {
    expect(pickAgent([])).toBeNull()
  })

  it('prioriza a quien no tiene nada EN_PROGRESO', () => {
    expect(pickAgent([
      agente(1, { en_progreso: true, carga_activa: 1 }),
      agente(2, { en_progreso: false, carga_activa: 5 })
    ])).toBe(2)
  })

  it('a igualdad, el de menor carga activa', () => {
    expect(pickAgent([agente(1, { carga_activa: 3 }), agente(2, { carga_activa: 1 })])).toBe(2)
  })

  it('a igualdad de carga, el que hace mas tiempo no recibe uno', () => {
    expect(pickAgent([
      agente(1, { ultimo_asignado: '2026-01-01T00:00:00Z' }),
      agente(2, { ultimo_asignado: '2025-06-01T00:00:00Z' })
    ])).toBe(2)
  })

  it('quien nunca recibio un ticket va primero', () => {
    expect(pickAgent([
      agente(1, { ultimo_asignado: '2025-01-01T00:00:00Z' }),
      agente(2, { ultimo_asignado: null })
    ])).toBe(2)
  })

  it('excluirId saca al agente actual (escalamiento)', () => {
    expect(pickAgent([agente(1), agente(2)], 1)).toBe(2)
    // Un solo agente en el sistema: no hay a quien escalarle.
    expect(pickAgent([agente(1)], 1)).toBeNull()
  })
})

describe('assertReassignable', () => {
  const destino = (o = {}) => ({ user_id: 7, active: 'Y', es_agente: true, carga_activa: 0, ...o })

  it('acepta un destino valido', () => {
    expect(assertReassignable(ticket(), destino(), 7)).toBe(true)
  })

  it('rechaza un ticket cerrado', () => {
    expect(() => assertReassignable(ticket({ status: 'CERRADO' }), destino(), 7)).toThrow(/cerrado/i)
  })

  it('rechaza reasignar al mismo', () => {
    expect(() => assertReassignable(ticket({ assigned_to_id: 7 }), destino(), 7)).toThrow(/ya está asignado/i)
  })

  it('rechaza a un usuario desactivado o que no es agente', () => {
    expect(() => assertReassignable(ticket(), destino({ active: 'N' }), 7)).toThrow(/no puede recibir/i)
    expect(() => assertReassignable(ticket(), destino({ es_agente: false }), 7)).toThrow(/no puede recibir/i)
    expect(() => assertReassignable(ticket(), null, 7)).toThrow(/no puede recibir/i)
  })

  it('rechaza a quien ya tiene tickets activos', () => {
    expect(() => assertReassignable(ticket(), destino({ carga_activa: 1 }), 7)).toThrow(/activos/i)
  })
})

describe('validateTicketInput', () => {
  const valido = { titulo: 'Sistema caído', problema: 'No puedo entrar al ERP desde hoy' }

  it('recorta y devuelve los datos limpios', () => {
    expect(validateTicketInput({ ...valido, titulo: '  Hola mundo  ' }).titulo).toBe('Hola mundo')
  })

  it('exige titulo de 3 a 120 y problema de 10 a 2000', () => {
    expect(() => validateTicketInput({ ...valido, titulo: 'ab' })).toThrow(/título/i)
    expect(() => validateTicketInput({ ...valido, titulo: 'a'.repeat(121) })).toThrow(/título/i)
    expect(() => validateTicketInput({ ...valido, problema: 'corto' })).toThrow(/problemática/i)
    expect(() => validateTicketInput({ ...valido, problema: 'a'.repeat(2001) })).toThrow(/problemática/i)
  })

  it('acepta los limites exactos', () => {
    expect(validateTicketInput({ titulo: 'abc', problema: 'a'.repeat(10) }).titulo).toBe('abc')
  })

  it('sin link devuelve null, no cadena vacia', () => {
    expect(validateTicketInput(valido).link).toBeNull()
  })

  it('acepta http y https', () => {
    expect(validateTicketInput({ ...valido, link: 'https://erp.test/x' }).link).toBe('https://erp.test/x')
  })

  it('no valida el formato de URL: se guarda lo que mandan', () => {
    expect(validateTicketInput({ ...valido, link: 'docs.google.com/x' }).link).toBe('docs.google.com/x')
  })

  it('acepta varios enlaces y los guarda uno por linea, sin repetidos', () => {
    expect(validateTicketInput({ ...valido, link: 'https://a.test\nhttps://b.test https://a.test' }).link)
      .toBe('https://a.test\nhttps://b.test')
    expect(validateTicketInput({ ...valido, link: ['https://a.test', 'https://b.test'] }).link)
      .toBe('https://a.test\nhttps://b.test')
  })

  it('quita el envoltorio que agrega Slack', () => {
    expect(validateTicketInput({ ...valido, link: '<https://a.test/x?y=1|Reporte>' }).link).toBe('https://a.test/x?y=1')
  })

  it('rechaza un link mas largo que el limite de la columna', () => {
    expect(() => validateTicketInput({ ...valido, link: `https://x.test/${'a'.repeat(2048)}` })).toThrow(/largo/i)
  })
})

describe('validateComment', () => {
  it('exige cuerpo no vacio y hasta 2000', () => {
    expect(validateComment('  hola  ')).toBe('hola')
    expect(() => validateComment('   ')).toThrow()
    expect(() => validateComment('a'.repeat(2001))).toThrow()
  })
})

describe('computeDueDates', () => {
  it('congela los dos plazos en horario habil desde el instante de creacion', () => {
    // Jueves 10:00 Lima (15:00Z): +1 h habil y +8 h habiles (cierra justo a las 18:00).
    const inicio = new Date('2026-01-01T15:00:00Z')
    const due = computeDueDates({ first_response_minutes: 60, resolution_minutes: 480 }, inicio)
    expect(due.first_response_due_at.toISOString()).toBe('2026-01-01T16:00:00.000Z')
    expect(due.resolution_due_at.toISOString()).toBe('2026-01-01T23:00:00.000Z')
  })

  it('sin politica no inventa plazos', () => {
    expect(computeDueDates(null, new Date())).toEqual({ first_response_due_at: null, resolution_due_at: null })
  })
})

describe('formatTicketCode', () => {
  it('rellena a cinco digitos y no recorta los mas grandes', () => {
    expect(formatTicketCode(42)).toBe('00042')
    expect(formatTicketCode(123456)).toBe('123456')
  })
})

describe('applyFilter y buildKpis', () => {
  const vencido = withSla(ticket({
    ticket_id: 1,
    first_response_due_at: new Date('2026-01-01T11:00:00Z'),
    resolution_due_at: new Date('2026-01-01T11:30:00Z')
  }), AHORA)
  const mio = withSla(ticket({ ticket_id: 2, assigned_to_id: 99 }), AHORA)
  const sinAsignar = withSla(ticket({ ticket_id: 3, assigned_to_id: null }), AHORA)
  const todos = [vencido, mio, sinAsignar]

  it('TODOS no filtra', () => {
    expect(applyFilter(todos, 'TODOS', 99)).toHaveLength(3)
  })

  it('MIOS trae los asignados a quien pregunta', () => {
    expect(applyFilter(todos, 'MIOS', 99).map(t => t.ticket_id)).toEqual([1, 2])
  })

  it('SIN_ASIGNAR trae los huerfanos', () => {
    expect(applyFilter(todos, 'SIN_ASIGNAR', 99).map(t => t.ticket_id)).toEqual([3])
  })

  it('VENCIDOS usa el veredicto del SLA, no el estado', () => {
    expect(applyFilter(todos, 'VENCIDOS', 99).map(t => t.ticket_id)).toEqual([1])
  })

  it('los KPIs cuentan sobre el total, no sobre lo filtrado', () => {
    expect(buildKpis(todos, 99)).toEqual({ total: 3, misAsignados: 2, sinAsignar: 1, porVencer: 0, vencidos: 1 })
  })
})
