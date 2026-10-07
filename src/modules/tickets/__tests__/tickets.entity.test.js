import { describe, it, expect } from 'vitest'
import { ForbiddenError } from '../../../shared/errors.js'
import {
  ticketScopeFor, canRead, assertCanRead, assertCanManage, nextStatus, pickAgent,
  assertReassignable, validateTicketInput, validateComment,
  computeDueDates, formatTicketCode, withSla, applyFilter, buildKpis,
  canChangeStatusOf, canReopenOf, reopenByReporter, validateDocumentInput,
  respondioElManual, assertNoEsDeOtro, canReassignOf, eventoDeTransicion,
  ticketIdDeBusqueda, escaparLike, parseTicketId
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

  // Jueves 10:00 Lima: 15 min habiles de respuesta vencen a las 10:15.
  const REABRE = new Date('2026-01-01T15:00:00Z')
  const PLAZOS = { first_response_minutes: 15, resolution_minutes: 240 }
  const porManual = (o = {}) => cerrado({
    manual_answer: 'RESUELTO', manual_answered_at: AHORA, first_response_at: AHORA, ...o
  })

  it('sin agente (lo cerró el manual antes del reparto): ABIERTO, sin primera respuesta y plazo nuevo', () => {
    expect(reopenByReporter(porManual({ assigned_to_id: null }), 10, REABRE, PLAZOS)).toEqual({
      status: 'ABIERTO',
      first_response_at: null,
      resolved_at: null,
      first_response_due_at: new Date('2026-01-01T15:15:00Z')
    })
  })

  it('con agente pero cerrado por el manual: tampoco cuenta como respondido', () => {
    expect(reopenByReporter(porManual(), 10, REABRE, PLAZOS))
      .toMatchObject({ status: 'ABIERTO', first_response_at: null })
  })

  it('un "No, sigo necesitando ayuda" no es respuesta del manual', () => {
    expect(respondioElManual(porManual({ manual_answer: 'NO_RESUELTO' }))).toBe(false)
    expect(reopenByReporter(porManual({ manual_answer: 'NO_RESUELTO' }), 10, REABRE, PLAZOS))
      .toEqual({ status: 'EN_PROGRESO', first_response_at: AHORA, resolved_at: null })
  })

  it('el agente que reabre un ticket cerrado por el manual da la primera respuesta ahora', () => {
    expect(nextStatus(porManual(), 99, 'EN_PROGRESO', REABRE).first_response_at).toBe(REABRE)
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

  // ticket() lo atiende el 99: es el unico que puede soltarlo.
  it('acepta un destino valido', () => {
    expect(assertReassignable(ticket(), destino(), 7, 99)).toBe(true)
  })

  it('sin dueño, cualquier agente puede asignarlo', () => {
    expect(assertReassignable(ticket({ assigned_to_id: null }), destino(), 7, 42)).toBe(true)
  })

  it('con dueño, otro agente no se lo puede llevar ni pasarlo a un tercero', () => {
    const delOtro = ticket({ asignado: 'Fernando' })
    expect(() => assertReassignable(delOtro, destino({ user_id: 42 }), 42, 42)).toThrow(/Solo Fernando/)
    expect(() => assertReassignable(delOtro, destino(), 7, 42)).toThrow(ForbiddenError)
  })

  it('rechaza un ticket cerrado', () => {
    expect(() => assertReassignable(ticket({ status: 'CERRADO' }), destino(), 7, 99)).toThrow(/cerrado/i)
  })

  it('rechaza reasignar al mismo', () => {
    expect(() => assertReassignable(ticket({ assigned_to_id: 7 }), destino(), 7, 7)).toThrow(/ya está asignado/i)
  })

  it('rechaza a un usuario desactivado o que no es agente', () => {
    expect(() => assertReassignable(ticket(), destino({ active: 'N' }), 7, 99)).toThrow(/no puede recibir/i)
    expect(() => assertReassignable(ticket(), destino({ es_agente: false }), 7, 99)).toThrow(/no puede recibir/i)
    expect(() => assertReassignable(ticket(), null, 7, 99)).toThrow(/no puede recibir/i)
  })

  it('rechaza a quien ya tiene tickets activos', () => {
    expect(() => assertReassignable(ticket(), destino({ carga_activa: 1 }), 7, 99)).toThrow(/activos/i)
  })
})

describe('un dueño a la vez', () => {
  const admin = { canManage: true }

  it('si lo atiende otro agente, 409 con su nombre (no un 403 generico)', () => {
    const delOtro = ticket({ assigned_to_id: 99, asignado: 'Fernando' })
    expect(() => assertNoEsDeOtro(delOtro, 42)).toThrow(/ya lo atiende Fernando/)
    try { assertNoEsDeOtro(delOtro, 42) } catch (err) { expect(err.statusCode).toBe(409) }
  })

  it('el dueño o un ticket sin dueño pasan', () => {
    expect(assertNoEsDeOtro(ticket(), 99)).toBeTruthy()
    expect(assertNoEsDeOtro(ticket({ assigned_to_id: null }), 42)).toBeTruthy()
  })

  it('reasignar: sin dueño cualquier agente, con dueño solo el dueño, cerrado nadie', () => {
    expect(canReassignOf(ticket({ assigned_to_id: null }), admin, 42)).toBe(true)
    expect(canReassignOf(ticket(), admin, 99)).toBe(true)
    expect(canReassignOf(ticket(), admin, 42)).toBe(false)
    expect(canReassignOf(ticket({ status: 'CERRADO' }), admin, 99)).toBe(false)
    expect(canReassignOf(ticket(), { canManage: false }, 99)).toBe(false)
  })
})

describe('eventoDeTransicion', () => {
  it('nombra el evento de la bitacora de cada cambio de estado', () => {
    expect(eventoDeTransicion('ABIERTO', 'EN_PROGRESO')).toBe('TOMADO')
    expect(eventoDeTransicion('EN_PROGRESO', 'CERRADO')).toBe('RESUELTO')
    expect(eventoDeTransicion('CERRADO', 'EN_PROGRESO')).toBe('REABIERTO')
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

describe('búsqueda y ids', () => {
  it('reconoce un número de ticket con o sin ceros y #', () => {
    expect(ticketIdDeBusqueda('42')).toBe(42)
    expect(ticketIdDeBusqueda('00042')).toBe(42)
    expect(ticketIdDeBusqueda(' #00042 ')).toBe(42)
  })

  it('texto, cero o un número fuera de rango no son un id', () => {
    expect(ticketIdDeBusqueda('no abre el ERP')).toBeNull()
    expect(ticketIdDeBusqueda('0')).toBeNull()
    expect(ticketIdDeBusqueda('9999999999')).toBeNull()
    expect(ticketIdDeBusqueda('')).toBeNull()
  })

  it('los comodines de LIKE se buscan como texto', () => {
    expect(escaparLike('50%_off\\')).toBe('50\\%\\_off\\\\')
  })

  it('parseTicketId: 400 para vacío, texto, cero, decimal o fuera de int4', () => {
    expect(parseTicketId('15')).toBe(15)
    for (const malo of [undefined, '', 'abc', '0', '1.5', '-3', '9999999999']) {
      expect(() => parseTicketId(malo)).toThrow(/ticket_id inválido/)
    }
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

  it('MIOS deja fuera los resueltos: el chip y la lista cuadran', () => {
    const resuelto = withSla(ticket({ ticket_id: 5, status: 'CERRADO', first_response_at: AHORA, resolved_at: AHORA }), AHORA)
    const conResuelto = [...todos, resuelto]
    expect(applyFilter(conResuelto, 'MIOS', 99).map(t => t.ticket_id)).toEqual([1, 2])
    expect(buildKpis(conResuelto, 99).misAsignados).toBe(2)
  })

  it('SIN_ASIGNAR trae los huerfanos', () => {
    expect(applyFilter(todos, 'SIN_ASIGNAR', 99).map(t => t.ticket_id)).toEqual([3])
  })

  it('VENCIDOS usa el veredicto del SLA, no el estado', () => {
    expect(applyFilter(todos, 'VENCIDOS', 99).map(t => t.ticket_id)).toEqual([1])
  })

  it('los KPIs cuentan sobre el total, no sobre lo filtrado', () => {
    expect(buildKpis(todos, 99)).toEqual({ total: 3, misAsignados: 2, sinAsignar: 1, porAsignar: 1, porVencer: 0, vencidos: 1 })
  })

  it('un CERRADO sin agente (cerrado por el manual) no cuenta ni se lista como sin asignar', () => {
    const cerrado = withSla(ticket({ ticket_id: 4, assigned_to_id: null, status: 'CERRADO' }), AHORA)
    const conCerrado = [...todos, cerrado]
    const kpis = buildKpis(conCerrado, 99)
    expect(kpis.sinAsignar).toBe(1)
    expect(kpis.porAsignar).toBe(1)
    expect(applyFilter(conCerrado, 'SIN_ASIGNAR', 99).map(t => t.ticket_id)).toEqual([3])
  })
})

describe('validateDocumentInput', () => {
  const pdf = { original_name: 'manual.pdf', stored_name: 'x.pdf', mime_type: 'application/pdf', size_bytes: 10 }
  const DESC = 'Qué hacer cuando el Sheets de ventas no muestra los datos'

  it('exige la descripción de qué trata (la lee la IA para enviar el manual)', () => {
    const url = 'https://docs.google.com/x'
    expect(() => validateDocumentInput({ titulo: 'Manual', tipo: 'ENLACE', url })).toThrow(/De qué trata/i)
    expect(() => validateDocumentInput({ titulo: 'Manual', descripcion: 'muy corta', tipo: 'ENLACE', url })).toThrow(/De qué trata/i)
    expect(validateDocumentInput({ titulo: 'Manual', descripcion: `  ${DESC}
 con   espacios `, tipo: 'ENLACE', url }).description)
      .toBe(`${DESC} con espacios`)
  })

  it('acepta un PDF con archivo y descarta la url', () => {
    expect(validateDocumentInput({ titulo: '  Manual FICO ', descripcion: DESC, tipo: 'pdf', url: 'https://x', archivo: pdf }))
      .toEqual({ title: 'Manual FICO', description: DESC, kind: 'PDF', url: null })
  })

  it('acepta un enlace https', () => {
    const url = 'https://docs.google.com/spreadsheets/d/abc/edit'
    expect(validateDocumentInput({ titulo: 'Tarifario', descripcion: DESC, tipo: 'ENLACE', url }))
      .toEqual({ title: 'Tarifario', description: DESC, kind: 'ENLACE', url })
  })

  it('rechaza un PDF sin archivo', () => {
    expect(() => validateDocumentInput({ titulo: 'Manual', descripcion: DESC, tipo: 'PDF' })).toThrow(/Adjunta/)
  })

  it('rechaza un enlace con archivo, vacío o sin http(s)', () => {
    expect(() => validateDocumentInput({ titulo: 'Doc', descripcion: DESC, tipo: 'ENLACE', url: 'https://x', archivo: pdf })).toThrow()
    expect(() => validateDocumentInput({ titulo: 'Doc', descripcion: DESC, tipo: 'ENLACE', url: '' })).toThrow(/Pega/)
    expect(() => validateDocumentInput({ titulo: 'Doc', descripcion: DESC, tipo: 'ENLACE', url: 'javascript:alert(1)' })).toThrow(/http/)
    expect(() => validateDocumentInput({ titulo: 'Doc', descripcion: DESC, tipo: 'ENLACE', url: 'no es url' })).toThrow(/válida/)
  })

  it('rechaza título corto y tipo desconocido', () => {
    expect(() => validateDocumentInput({ titulo: 'ab', descripcion: DESC, tipo: 'ENLACE', url: 'https://x' })).toThrow(/título/)
    expect(() => validateDocumentInput({ titulo: 'Manual', descripcion: DESC, tipo: 'WORD', url: 'https://x' })).toThrow(/PDF o un enlace/)
  })
})
