import { describe, it, expect, vi, beforeEach } from 'vitest'

// El repositorio y Slack se doblan enteros: estos casos prueban la
// ORQUESTACION (que se congelen los plazos, que no se escale dos veces, que un
// aviso no se selle si Slack rechazo), no el SQL ni la red.
const repo = {
  slaPolicy: vi.fn(),
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
  reassign: vi.fn()
}

const slack = {
  notificarTicketCreado: vi.fn(),
  notificarTicketCerrado: vi.fn(),
  notificarTicketEscalado: vi.fn(),
  notificarTicketReabierto: vi.fn(),
  notificarEsperandoAsignacion: vi.fn(),
  notificarSlaIncumplido: vi.fn(),
  avisarTicketTomado: vi.fn(),
  avisarTicketResuelto: vi.fn(),
  buscarUsuarioSlackPorEmail: vi.fn(),
  descargarArchivoSlack: vi.fn(),
  avisarComentarioNuevo: vi.fn(),
  abrirHiloDeTicket: vi.fn(),
  obtenerEmailDeUsuarioSlack: vi.fn(),
  slackWebhookConfigurado: vi.fn(() => true)
}

vi.mock('../tickets.repository.js', () => ({ ticketsRepository: repo }))
vi.mock('../../../shared/adapters/slack/tickets-slack.adapter.js', () => slack)

const { createTicket, runSlaSweep, runAutoAssignSweep, createTicketFromSlack } = await import('../tickets.usecases.js')

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
  it('congela los plazos con la politica vigente al crear', async () => {
    repo.slaPolicy.mockResolvedValue({ first_response_minutes: 60, resolution_minutes: 480 })
    repo.agentCandidates.mockResolvedValue([agente(7)])
    repo.create.mockResolvedValue(1)

    await createTicket({ userId: 10, ...VALIDO })

    const [fila] = repo.create.mock.calls[0]
    const inicio = fila.registration_date.getTime()
    expect(fila.first_response_due_at.getTime() - inicio).toBe(60 * 60_000)
    expect(fila.resolution_due_at.getTime() - inicio).toBe(480 * 60_000)
  })

  it('clasifica la prioridad sola: quien reporta no la manda', async () => {
    repo.slaPolicy.mockResolvedValue({ first_response_minutes: 60, resolution_minutes: 480 })
    repo.agentCandidates.mockResolvedValue([agente(7)])
    repo.create.mockResolvedValue(1)

    await createTicket({ userId: 10, titulo: 'Instalar Office', problema: 'Necesito que me instalen Office en la laptop' })

    expect(repo.create.mock.calls[0][0].priority).toBe('BAJA')
  })

  it('sin agentes responde 503, no 500', async () => {
    repo.agentCandidates.mockResolvedValue([])
    repo.slaPolicy.mockResolvedValue(null)

    await expect(createTicket({ userId: 10, ...VALIDO })).rejects.toMatchObject({ statusCode: 503 })
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('una entrada invalida ni consulta la BD', async () => {
    await expect(createTicket({ userId: 10, titulo: 'ab', problema: 'x' })).rejects.toThrow(/título/i)
    expect(repo.agentCandidates).not.toHaveBeenCalled()
  })

  it('sin politica en la tabla el ticket igual se crea, sin plazos', async () => {
    repo.slaPolicy.mockResolvedValue(null)
    repo.agentCandidates.mockResolvedValue([agente(7)])
    repo.create.mockResolvedValue(1)

    await createTicket({ userId: 10, ...VALIDO })

    expect(repo.create.mock.calls[0][0].first_response_due_at).toBeNull()
  })

  it('nace SIN asignar y avisa por Slack que espera asignacion manual', async () => {
    repo.slaPolicy.mockResolvedValue({ first_response_minutes: 60, resolution_minutes: 480 })
    repo.agentCandidates.mockResolvedValue([agente(7)])
    repo.create.mockResolvedValue(1)

    await createTicket({ userId: 10, ...VALIDO })

    // Solo se comprueba que EXISTA algun agente; no se elige ninguno todavia.
    expect(repo.create.mock.calls[0][0].assigned_to_id).toBeNull()
    expect(slack.notificarEsperandoAsignacion).toHaveBeenCalled()
  })
})

describe('runAutoAssignSweep', () => {
  it('reparte un ABIERTO sin asignar cuya ventana de gracia ya paso', async () => {
    repo.unassignedOlderThan.mockResolvedValue([ticketFila({ assigned_to_id: null })])
    repo.agentCandidates.mockResolvedValue([agente(7)])

    const asignados = await runAutoAssignSweep(AHORA)

    expect(asignados).toBe(1)
    expect(repo.reassign).toHaveBeenCalledWith(1, 7)
    expect(slack.notificarTicketEscalado).toHaveBeenCalled()
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
    repo.slaPolicy.mockResolvedValue({ first_response_minutes: 60, resolution_minutes: 480 })
    repo.agentCandidates.mockResolvedValue([agente(7)])
    repo.create.mockResolvedValue(1)
    slack.abrirHiloDeTicket.mockResolvedValue({ canal: 'D123', ts: '1.2' })

    await createTicketFromSlack({ slackUserId: 'U1', ...VALIDO })

    expect(repo.create.mock.calls[0][0].created_by_id).toBe(55)
    // El hilo se abre fuera del camino critico; se espera a que decante.
    await vi.waitFor(() => expect(repo.saveSlackThread).toHaveBeenCalledWith(1, { channelId: 'D123', messageTs: '1.2' }))
  })
})
