import { describe, it, expect, vi, beforeEach } from 'vitest'

// El repositorio y Slack se doblan enteros: estos casos prueban la
// ORQUESTACION (que se congelen los plazos, que no se escale dos veces, que un
// aviso no se selle si Slack rechazo), no el SQL ni la red.
const repo = {
  agentCandidates: vi.fn(),
  create: vi.fn(),
  detail: vi.fn(),
  escalationCandidates: vi.fn(),
  applyEscalation: vi.fn(),
  overdueClocks: vi.fn(),
  sealAlert: vi.fn(),
  saveSlackThread: vi.fn(),
  findActiveUserByEmail: vi.fn(),
  unassignedOlderThan: vi.fn(),
  reassign: vi.fn(),
  updateStatus: vi.fn(),
  createComment: vi.fn(),
  comments: vi.fn(async () => []),
  claim: vi.fn(),
  assignableById: vi.fn(),
  attachmentsOf: vi.fn(async () => []),
  list: vi.fn(async () => [])
}

const slack = {
  notificarTicketCreado: vi.fn(),
  notificarTicketCerrado: vi.fn(),
  notificarTicketEscalado: vi.fn(),
  notificarTicketReabierto: vi.fn(),
  notificarEsperandoAsignacion: vi.fn(),
  notificarSlaIncumplido: vi.fn(),
  avisarTicketTomado: vi.fn(),
  notificarTicketTomado: vi.fn(),
  avisarTicketResuelto: vi.fn(),
  avisarTicketReasignado: vi.fn(),
  buscarUsuarioSlackPorEmail: vi.fn(),
  descargarArchivoSlack: vi.fn(),
  avisarComentarioNuevo: vi.fn(),
  abrirHiloDeTicket: vi.fn(),
  // Sin bot configurado el manual (manual/) no se ofrece: estos tests no lo cubren.
  slackBotConfigurado: vi.fn(() => false),
  obtenerEmailDeUsuarioSlack: vi.fn(),
  slackWebhookConfigurado: vi.fn(() => true)
}

vi.mock('../tickets.repository.js', () => ({ ticketsRepository: repo }))
vi.mock('../../../shared/adapters/slack/tickets-slack.adapter.js', () => slack)

const {
  createTicket, runSlaSweep, runAutoAssignSweep, createTicketFromSlack, setTicketsPorts,
  changeStatus, reassign, reopenTicket, listTickets, addComment
} = await import('../tickets.usecases.js')

const publicarCambio = vi.fn().mockResolvedValue(undefined)
setTicketsPorts({ publicarCambio })
// El aviso en vivo sale fuera del await (best-effort): se deja correr la cola.
const flush = () => new Promise(r => setTimeout(r, 0))

const AHORA = new Date('2026-03-15T12:00:00Z')
const hace = h => new Date(AHORA.getTime() - h * 3600_000)
const dentro = h => new Date(AHORA.getTime() + h * 3600_000)

const agente = (id, o = {}) => ({ user_id: id, carga_activa: 0, en_progreso: false, ultimo_asignado: null, ...o })

const ticketFila = (o = {}) => ({
  ticket_id: 1,
  title: 'Falla',
  priority: 'ALTA',
  status: 'ABIERTO',
  created_by_id: 10,
  assigned_to_id: 99,
  creador_roles: ['COMERCIAL'],
  registration_date: hace(2),
  first_response_due_at: null,
  first_response_at: null,
  resolution_due_at: null,
  resolved_at: null,
  ...o
})

const VALIDO = { titulo: 'No abre el ERP', problema: 'Desde hoy no puedo entrar al sistema' }

beforeEach(() => {
  vi.clearAllMocks()
  slack.slackWebhookConfigurado.mockReturnValue(true)
  repo.detail.mockResolvedValue(ticketFila())
})

describe('createTicket', () => {
  it('congela los plazos del .md (ALTA = P1) en horario habil al crear', async () => {
    // Jueves 10:00 Lima: ALTA = 15 min de respuesta y 4 h habiles de resolucion.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T15:00:00Z'))
    try {
      repo.agentCandidates.mockResolvedValue([agente(7)])
      repo.create.mockResolvedValue(1)

      await createTicket({
        userId: 10,
        titulo: 'Matrícula no se registró',
        problema: 'La inscripción del alumno no quedó guardada en el sistema'
      })

      const [fila] = repo.create.mock.calls[0]
      expect(fila.priority).toBe('ALTA')
      expect(fila.first_response_due_at.toISOString()).toBe('2026-01-01T15:15:00.000Z')
      expect(fila.resolution_due_at.toISOString()).toBe('2026-01-01T19:00:00.000Z')
    } finally {
      vi.useRealTimers()
    }
  })

  it('clasifica la prioridad sola: quien reporta no la manda', async () => {
    repo.agentCandidates.mockResolvedValue([agente(7)])
    repo.create.mockResolvedValue(1)

    await createTicket({ userId: 10, titulo: 'Instalar Office', problema: 'Necesito que me instalen Office en la laptop' })

    expect(repo.create.mock.calls[0][0].priority).toBe('BAJA')
  })

  it('sin agentes responde 503, no 500', async () => {
    repo.agentCandidates.mockResolvedValue([])

    await expect(createTicket({ userId: 10, ...VALIDO })).rejects.toMatchObject({ statusCode: 503 })
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('una entrada invalida ni consulta la BD', async () => {
    await expect(createTicket({ userId: 10, titulo: 'ab', problema: 'x' })).rejects.toThrow(/título/i)
    expect(repo.agentCandidates).not.toHaveBeenCalled()
  })

  it('nace SIN asignar y avisa por Slack que espera asignacion manual', async () => {
    repo.agentCandidates.mockResolvedValue([agente(7)])
    repo.create.mockResolvedValue(1)

    await createTicket({ userId: 10, ...VALIDO })

    // Solo se comprueba que EXISTA algun agente; no se elige ninguno todavia.
    expect(repo.create.mock.calls[0][0].assigned_to_id).toBeNull()
    expect(slack.notificarEsperandoAsignacion).toHaveBeenCalled()
  })

  it('avisa en vivo que hay un ticket nuevo (sin datos, solo el id)', async () => {
    repo.agentCandidates.mockResolvedValue([agente(7)])
    repo.create.mockResolvedValue(1)

    await createTicket({ userId: 10, ...VALIDO })
    await flush()

    expect(publicarCambio).toHaveBeenCalledWith({ tipo_evento: 'tickets_actualizados', ticket_id: 1 })
  })

  it('si el aviso en vivo falla, el ticket se crea igual', async () => {
    repo.agentCandidates.mockResolvedValue([agente(7)])
    repo.create.mockResolvedValue(1)
    publicarCambio.mockRejectedValueOnce(new Error('pg caido'))
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(createTicket({ userId: 10, ...VALIDO })).resolves.toBeTruthy()
    await flush()
    errorLog.mockRestore()
  })
})

describe('runAutoAssignSweep', () => {
  it('reparte un ABIERTO sin asignar cuya ventana de gracia ya paso', async () => {
    repo.unassignedOlderThan.mockResolvedValue([ticketFila({ assigned_to_id: null })])
    repo.agentCandidates.mockResolvedValue([agente(7)])

    const asignados = await runAutoAssignSweep(AHORA)

    expect(asignados).toBe(1)
    // Queda en la bitacora como asignacion del sistema.
    expect(repo.reassign).toHaveBeenCalledWith(1, 7, { kind: 'ASIGNADO', toUserId: 7, detail: 'AUTOMATICO' })
    expect(slack.notificarTicketEscalado).toHaveBeenCalled()
    // A quien reporto se le dice "asignado", no "reasignado": no tenia dueño.
    expect(slack.avisarTicketReasignado).toHaveBeenCalledWith(expect.anything(), expect.any(String), { primeraAsignacion: true })
    await flush()
    expect(publicarCambio).toHaveBeenCalledWith({ tipo_evento: 'tickets_actualizados', ticket_id: 1 })
  })

  it('sin agentes disponibles no rompe: se reintenta en la proxima corrida', async () => {
    repo.unassignedOlderThan.mockResolvedValue([ticketFila({ assigned_to_id: null })])
    repo.agentCandidates.mockResolvedValue([])

    expect(await runAutoAssignSweep(AHORA)).toBe(0)
    expect(repo.reassign).not.toHaveBeenCalled()
  })

  it('sin candidatos vencidos no consulta agentes', async () => {
    repo.unassignedOlderThan.mockResolvedValue([])

    expect(await runAutoAssignSweep(AHORA)).toBe(0)
    expect(repo.agentCandidates).not.toHaveBeenCalled()
  })
})

describe('runSlaSweep · escalamiento', () => {
  beforeEach(() => {
    repo.overdueClocks.mockResolvedValue([])
  })

  it('escala un ABIERTO cuya primera respuesta vencio', async () => {
    repo.escalationCandidates.mockResolvedValue([
      ticketFila({ first_response_due_at: hace(1), registration_date: hace(5) })
    ])
    repo.agentCandidates.mockResolvedValue([agente(99), agente(42)])

    const { escalados } = await runSlaSweep(AHORA)

    expect(escalados).toBe(1)
    // Se lo pasa a OTRO agente, no al que ya lo tenia.
    expect(repo.applyEscalation).toHaveBeenCalledWith(1, 42, 99, AHORA)
    expect(slack.avisarTicketReasignado).toHaveBeenCalledTimes(1)
  })

  it('no escala si el reloj todavia tiene margen', async () => {
    repo.escalationCandidates.mockResolvedValue([
      ticketFila({ registration_date: hace(1), first_response_due_at: dentro(50) })
    ])
    repo.agentCandidates.mockResolvedValue([agente(99), agente(42)])

    expect((await runSlaSweep(AHORA)).escalados).toBe(0)
    expect(repo.applyEscalation).not.toHaveBeenCalled()
  })

  it('con un unico agente no escala: solo deja constancia', async () => {
    repo.escalationCandidates.mockResolvedValue([ticketFila({ first_response_due_at: hace(1) })])
    repo.agentCandidates.mockResolvedValue([agente(99)])

    expect((await runSlaSweep(AHORA)).escalados).toBe(0)
    expect(repo.applyEscalation).not.toHaveBeenCalled()
  })

  it('no vuelve a escalar lo ya escalado: la cola no lo trae', async () => {
    // escalationCandidates filtra por escalated_at IS NULL, asi que una segunda
    // corrida sobre el mismo ticket no tiene nada que hacer.
    repo.escalationCandidates.mockResolvedValue([])
    repo.agentCandidates.mockResolvedValue([agente(99), agente(42)])

    expect((await runSlaSweep(AHORA)).escalados).toBe(0)
  })

  it('TICKETS_SLA_ESCALATION=false lo apaga sin tocar las alertas', async () => {
    vi.stubEnv('TICKETS_SLA_ESCALATION', 'false')
    repo.escalationCandidates.mockResolvedValue([ticketFila({ first_response_due_at: hace(1) })])

    expect((await runSlaSweep(AHORA)).escalados).toBe(0)
    expect(repo.escalationCandidates).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })
})

describe('runSlaSweep · alertas', () => {
  beforeEach(() => {
    repo.escalationCandidates.mockResolvedValue([])
  })

  it('avisa y sella el reloj vencido', async () => {
    repo.overdueClocks.mockResolvedValue([
      ticketFila({ first_response_due_at: hace(1), resolution_due_at: dentro(5) })
    ])
    slack.notificarSlaIncumplido.mockResolvedValue(true)

    const { alertas } = await runSlaSweep(AHORA)

    expect(alertas).toBe(1)
    expect(repo.sealAlert).toHaveBeenCalledWith(1, 'respuesta', AHORA)
  })

  it('NO sella si Slack no confirmo: el aviso queda para la proxima corrida', async () => {
    repo.overdueClocks.mockResolvedValue([ticketFila({ first_response_due_at: hace(1) })])
    slack.notificarSlaIncumplido.mockResolvedValue(false)

    const { alertas } = await runSlaSweep(AHORA)

    expect(alertas).toBe(0)
    expect(repo.sealAlert).not.toHaveBeenCalled()
  })

  it('un reloj ya cumplido no genera aviso', async () => {
    repo.overdueClocks.mockResolvedValue([
      ticketFila({ first_response_due_at: hace(2), first_response_at: hace(3) })
    ])

    expect((await runSlaSweep(AHORA)).alertas).toBe(0)
    expect(slack.notificarSlaIncumplido).not.toHaveBeenCalled()
  })

  it('un reloj ya avisado no se repite', async () => {
    repo.overdueClocks.mockResolvedValue([
      ticketFila({ first_response_due_at: hace(2), response_alert_sent_at: hace(1) })
    ])

    expect((await runSlaSweep(AHORA)).alertas).toBe(0)
  })

  it('los dos relojes vencidos del mismo ticket avisan por separado', async () => {
    repo.overdueClocks.mockResolvedValue([
      ticketFila({ first_response_due_at: hace(3), resolution_due_at: hace(1) })
    ])
    slack.notificarSlaIncumplido.mockResolvedValue(true)

    expect((await runSlaSweep(AHORA)).alertas).toBe(2)
    expect(repo.sealAlert).toHaveBeenCalledWith(1, 'respuesta', AHORA)
    expect(repo.sealAlert).toHaveBeenCalledWith(1, 'resolucion', AHORA)
  })

  it('sin webhook no recorre la BD para nada', async () => {
    slack.slackWebhookConfigurado.mockReturnValue(false)

    await runSlaSweep(AHORA)

    expect(repo.overdueClocks).not.toHaveBeenCalled()
  })
})

describe('listTickets · búsqueda', () => {
  it('escapa los comodines y busca también por número de ticket', async () => {
    await listTickets({ roles: ['ADMIN'], userId: 9, busqueda: ' #00042 ' })
    expect(repo.list).toHaveBeenCalledWith(expect.anything(), { busqueda: '#00042', busquedaId: 42, orden: 'sla' })

    await listTickets({ roles: ['ADMIN'], userId: 9, busqueda: '50%' })
    expect(repo.list).toHaveBeenLastCalledWith(expect.anything(), { busqueda: '50\\%', busquedaId: null, orden: 'sla' })
  })
})

describe('addComment · aviso por DM', () => {
  const hiloCon = (id, autor) => [{ ticket_comment_id: id, autor, body: 'x' }]

  beforeEach(() => {
    // Ticket del 10, lo atiende Fernando (99).
    repo.detail.mockResolvedValue(ticketFila({ created_by_id: 10, assigned_to_id: 99, asignado: 'Fernando' }))
    repo.createComment.mockResolvedValue(77)
  })

  it('si comenta otro admin, el DM dice SU nombre, no el del agente asignado', async () => {
    repo.comments.mockResolvedValue(hiloCon(77, 'Isma'))
    await addComment({ roles: ['ADMIN'], userId: 64, ticketId: '1', cuerpo: 'Lo reviso yo' })
    expect(slack.avisarComentarioNuevo).toHaveBeenCalledWith(expect.anything(), 'Isma', 'Lo reviso yo')
  })

  it('si comenta el líder del área, el DM lo nombra a él, no a "Soporte"', async () => {
    repo.comments.mockResolvedValue(hiloCon(77, 'Arleth'))
    await addComment({ roles: ['LIDER_COMERCIAL'], userId: 2, ticketId: '1', cuerpo: 'Ya lo vi' })
    expect(slack.avisarComentarioNuevo).toHaveBeenCalledWith(expect.anything(), 'Arleth', 'Ya lo vi')
  })

  it('lo que escribe el propio solicitante no se replica en su DM', async () => {
    repo.comments.mockResolvedValue(hiloCon(77, 'Camilo'))
    await addComment({ roles: ['COMERCIAL'], userId: 10, ticketId: '1', cuerpo: 'Sigue igual' })
    expect(slack.avisarComentarioNuevo).not.toHaveBeenCalled()
  })
})

describe('addComment', () => {
  it('un ticket_id inválido es 400 y no consulta la BD', async () => {
    await expect(addComment({ roles: ['ADMIN'], userId: 9, ticketId: 'abc', cuerpo: 'hola' }))
      .rejects.toMatchObject({ statusCode: 400 })
    expect(repo.detail).not.toHaveBeenCalled()
  })
})

describe('un dueño a la vez', () => {
  const ADMIN = ['ADMIN']

  it('tomar un ticket que ya atiende otro agente responde 409 con su nombre y no toca nada', async () => {
    repo.detail.mockResolvedValue(ticketFila({ assigned_to_id: 99, asignado: 'Fernando' }))

    await expect(changeStatus({ roles: ADMIN, userId: 42, ticketId: 1, estado: 'EN_PROGRESO' }))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/ya lo atiende Fernando/) })
    expect(repo.claim).not.toHaveBeenCalled()
    expect(repo.updateStatus).not.toHaveBeenCalled()
  })

  it('el dueño lo toma y queda TOMADO en la bitacora con su actor', async () => {
    repo.detail.mockResolvedValue(ticketFila({ assigned_to_id: 99 }))

    await changeStatus({ roles: ADMIN, userId: 99, ticketId: 1, estado: 'EN_PROGRESO' })

    expect(repo.updateStatus).toHaveBeenCalledWith(1, expect.objectContaining({ status: 'EN_PROGRESO' }), { kind: 'TOMADO', actorId: 99 })
  })

  it('otro agente no puede reasignar un ticket con dueño', async () => {
    repo.detail.mockResolvedValue(ticketFila({ assigned_to_id: 99, asignado: 'Fernando' }))
    repo.assignableById.mockResolvedValue({ user_id: 42, active: 'Y', es_agente: true, carga_activa: 0 })

    await expect(reassign({ roles: ADMIN, userId: 42, ticketId: 1, nuevoAsignadoId: 42 }))
      .rejects.toMatchObject({ statusCode: 403 })
    expect(repo.reassign).not.toHaveBeenCalled()
  })

  it('el dueño reasigna y queda REASIGNADO de el al nuevo', async () => {
    repo.detail.mockResolvedValue(ticketFila({ assigned_to_id: 99, status: 'EN_PROGRESO' }))
    repo.assignableById.mockResolvedValue({ user_id: 42, active: 'Y', es_agente: true, carga_activa: 0 })

    await reassign({ roles: ADMIN, userId: 99, ticketId: 1, nuevoAsignadoId: 42 })

    expect(repo.reassign).toHaveBeenCalledWith(1, 42, { kind: 'REASIGNADO', actorId: 99, fromUserId: 99, toUserId: 42 })
  })
})

describe('reopenTicket', () => {
  it('reabrir uno que cerro el manual le da un plazo de respuesta nuevo y lo deja REABIERTO en la bitacora', async () => {
    const manual = new Date('2026-01-01T14:00:00Z')
    repo.detail.mockResolvedValue(ticketFila({
      status: 'CERRADO', assigned_to_id: null, created_by_id: 10, priority: 'ALTA',
      first_response_at: manual, resolved_at: manual, manual_answer: 'RESUELTO', manual_answered_at: manual
    }))

    await reopenTicket({ roles: ['COMERCIAL'], userId: 10, ticketId: 1 })

    const [, cambios, evento] = repo.updateStatus.mock.calls[0]
    expect(cambios).toMatchObject({ status: 'ABIERTO', first_response_at: null, resolved_at: null })
    expect(cambios.first_response_due_at).toBeInstanceOf(Date)
    expect(evento).toEqual({ kind: 'REABIERTO', actorId: 10 })
  })
})

describe('createTicketFromSlack', () => {
  it('sin email de Slack explica por que, en vez de fallar seco', async () => {
    slack.obtenerEmailDeUsuarioSlack.mockResolvedValue(null)

    await expect(createTicketFromSlack({ slackUserId: 'U1', ...VALIDO }))
      .rejects.toThrow(/email de Slack/i)
  })

  it('si el correo no existe en el ERP lo dice con el correo a la vista', async () => {
    slack.obtenerEmailDeUsuarioSlack.mockResolvedValue('nadie@we.edu.pe')
    repo.findActiveUserByEmail.mockResolvedValue(null)

    await expect(createTicketFromSlack({ slackUserId: 'U1', ...VALIDO }))
      .rejects.toThrow(/nadie@we\.edu\.pe/)
  })

  it('con match crea el ticket a nombre de esa persona y abre el hilo', async () => {
    slack.obtenerEmailDeUsuarioSlack.mockResolvedValue('ana@we.edu.pe')
    repo.findActiveUserByEmail.mockResolvedValue({ user_id: 55, name: 'Ana' })
    repo.agentCandidates.mockResolvedValue([agente(7)])
    repo.create.mockResolvedValue(1)
    slack.abrirHiloDeTicket.mockResolvedValue({ canal: 'D123', ts: '1.2' })

    await createTicketFromSlack({ slackUserId: 'U1', ...VALIDO })

    expect(repo.create.mock.calls[0][0].created_by_id).toBe(55)
    // El hilo se abre fuera del camino critico; se espera a que decante.
    await vi.waitFor(() => expect(repo.saveSlackThread).toHaveBeenCalledWith(1, { channelId: 'D123', messageTs: '1.2' }))
  })

  it('el mensaje de apertura lleva los tickets abiertos de quien reporta, sin los cerrados', async () => {
    slack.obtenerEmailDeUsuarioSlack.mockResolvedValue('ana@we.edu.pe')
    repo.findActiveUserByEmail.mockResolvedValue({ user_id: 55, name: 'Ana' })
    repo.agentCandidates.mockResolvedValue([agente(7)])
    repo.create.mockResolvedValue(1)
    repo.detail.mockResolvedValue(ticketFila({ created_by_id: 55 }))
    repo.list.mockResolvedValue([
      ticketFila({ ticket_id: 1, status: 'ABIERTO' }),
      ticketFila({ ticket_id: 2, status: 'EN_PROGRESO' }),
      ticketFila({ ticket_id: 3, status: 'CERRADO' })
    ])
    slack.abrirHiloDeTicket.mockResolvedValue(null)

    await createTicketFromSlack({ slackUserId: 'U1', ...VALIDO })

    await vi.waitFor(() => expect(slack.abrirHiloDeTicket).toHaveBeenCalled())
    expect(repo.list).toHaveBeenCalledWith({ areaRoles: null, userId: 55 })
    expect(slack.abrirHiloDeTicket.mock.calls[0][2].map(t => t.ticket_id)).toEqual([1, 2])
  })
})
