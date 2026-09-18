import { ticketsRepository } from './tickets.repository.js'
import { clasificarPrioridad } from './tickets.priority.js'
import {
  ticketScopeFor, assertCanRead, assertCanComment, assertCanManage,
  nextStatus, pickAgent, assertReassignable,
  validateTicketInput, validateComment, validateSlaPolicy,
  computeDueDates, withSla, applyFilter, buildKpis, formatTicketCode, ticketAreaLabel
} from './tickets.entity.js'
import { evaluarReloj } from '../../shared/sla/sla-clock.js'
import { DomainError, NotFoundError } from '../../shared/errors.js'
import { removeAttachments } from './tickets.files.js'
import * as slack from '../../shared/adapters/slack/tickets-slack.adapter.js'

// Orquestacion: consulta al repositorio, decide con la entity y dispara los
// efectos externos. Los avisos a Slack van siempre con `void`: no suman latencia
// a la respuesta y un webhook caido no puede voltear algo ya guardado en la BD.

const repo = ticketsRepository

// ── Lectura ────────────────────────────────────────────────────────────────

export async function listTickets ({ roles = [], userId = null, filtro = 'TODOS', busqueda = '', orden = 'sla' } = {}) {
  const scope = ticketScopeFor({ roles, userId })
  const ahora = new Date()

  const rows = (await repo.list(scope, { busqueda, orden })).map(r => withSla(r, ahora))

  return {
    // El frontend no deriva permisos de localStorage: los recibe de aca, que es
    // la misma fuente que decidio el filtro de la consulta.
    scope: { kind: scope.kind, area: scope.area, canManage: scope.canManage },
    kpis: buildKpis(rows, userId),
    tickets: applyFilter(rows, filtro, userId)
  }
}

export async function ticketDetail ({ roles = [], userId = null, ticketId }) {
  const scope = ticketScopeFor({ roles, userId })
  const ticket = await repo.detail(ticketId)
  if (!ticket) throw new NotFoundError('Ticket no encontrado')
  assertCanRead(ticket, scope, userId)

  return {
    ...withSla(ticket),
    // El listado solo necesita cuantos hay; el detalle, cuales son.
    adjuntosLista: await repo.attachmentsOf(ticketId),
    canManage: scope.canManage,
    // Mover el estado exige ser el agente asignado, no solo ser ADMIN.
    canChangeStatus: scope.canManage && ticket.assigned_to_id === userId
  }
}

export async function listComments ({ roles = [], userId = null, ticketId }) {
  const scope = ticketScopeFor({ roles, userId })
  const ticket = await repo.detail(ticketId)
  if (!ticket) throw new NotFoundError('Ticket no encontrado')
  assertCanRead(ticket, scope, userId)
  return repo.comments(ticketId)
}

/**
 * Descarga de adjunto. `kind` distingue el adjunto del ticket del adjunto de un
 * comentario; ambos resuelven el ticket dueno en la misma consulta para poder
 * aplicarle el mismo control de acceso que al detalle.
 */
export async function downloadAttachment ({ roles = [], userId = null, attachmentId, kind = 'ticket' }) {
  const scope = ticketScopeFor({ roles, userId })
  const adjunto = kind === 'comment'
    ? await repo.commentAttachment(attachmentId)
    : await repo.attachment(attachmentId)

  if (!adjunto) throw new NotFoundError('Adjunto no encontrado')
  assertCanRead(adjunto, scope, userId)
  return adjunto
}

// ── Creacion ───────────────────────────────────────────────────────────────

/**
 * Alta de ticket. Mismo camino para la web y para el slash command de Slack:
 * validar, clasificar la prioridad, congelar los plazos con la politica vigente
 * y repartir entre los agentes disponibles.
 */
export async function createTicket ({ userId, titulo, problema, link, archivos = [], slackUserId = null }) {
  const datos = validateTicketInput({ titulo, problema, link })

  // La prioridad la decide el contenido, no quien reporta.
  const priority = clasificarPrioridad(datos.titulo, datos.problema)

  // registration_date explicito (y no el default de la BD) para que ambos
  // relojes cuenten desde exactamente el mismo instante que queda en la fila.
  const registrationDate = new Date()
  const policy = await repo.slaPolicy(priority)
  const vencimientos = computeDueDates(policy, registrationDate)

  const asignadoA = pickAgent(await repo.agentCandidates())
  if (asignadoA === null) {
    // 503 y no 500: no hay nada roto, no hay a quien asignarlo todavia.
    await removeAttachments(archivos.map(a => a.stored_name))
    throw new DomainError('No hay agentes disponibles para atender el ticket', { statusCode: 503, code: 'NO_AGENTS' })
  }

  let ticketId
  try {
    ticketId = await repo.create({
      title: datos.titulo,
      problem: datos.problema,
      link: datos.link,
      priority,
      created_by_id: userId,
      assigned_to_id: asignadoA,
      registration_date: registrationDate,
      ...vencimientos
    }, archivos)
  } catch (err) {
    // La transaccion se deshizo sola; lo que queda huerfano es el disco.
    await removeAttachments(archivos.map(a => a.stored_name))
    throw err
  }

  const ticket = await repo.detail(ticketId)
  // El area no viaja en la fila: se calcula aca (mismo dato que ya trae
  // creador_roles) para que el adaptador de Slack no tenga que conocer el
  // organigrama del ERP.
  void slack.notificarTicketCreado({ ...ticket, area: ticketAreaLabel(ticket.creador_roles) })

  // El efimero del slash command se pierde al cerrar Slack y su response_url
  // caduca a los 30 minutos: el seguimiento vive en un DM propio.
  if (slackUserId) void abrirSeguimiento(ticket, slackUserId)

  return withSla(ticket)
}

async function abrirSeguimiento (ticket, slackUserId) {
  const mensaje = await slack.abrirHiloDeTicket(ticket, slackUserId)
  if (!mensaje) return
  try {
    await repo.saveSlackThread(ticket.ticket_id, { channelId: mensaje.canal, messageTs: mensaje.ts })
  } catch (err) {
    // El DM ya salio; si no se puede guardar la referencia el ticket se queda
    // sin seguimiento, pero no se pierde ni se deja una excepcion suelta (esto
    // corre fuera del ciclo request/response).
    console.error(`[tickets] no se pudo guardar el hilo del ticket #${ticket.ticket_id}`, err.message)
  }
}

// ── Gestion (solo ADMIN) ───────────────────────────────────────────────────

export async function changeStatus ({ roles = [], userId = null, ticketId, estado }) {
  const scope = ticketScopeFor({ roles, userId })
  assertCanManage(scope)

  const ticket = await repo.detail(ticketId)
  if (!ticket) throw new NotFoundError('Ticket no encontrado')

  const ahora = new Date()
  const cambios = nextStatus(ticket, userId, estado, ahora)
  await repo.updateStatus(ticketId, cambios)

  const actualizado = await repo.detail(ticketId)
  const agente = actualizado.asignado ?? 'Soporte'

  // Unico punto por el que un ticket llega a CERRADO: lo garantiza nextStatus.
  if (estado === 'CERRADO') void slack.notificarTicketCerrado(actualizado)
  void (estado === 'CERRADO'
    ? slack.avisarTicketResuelto(actualizado, agente)
    : slack.avisarTicketTomado(actualizado, agente))

  return withSla(actualizado, ahora)
}

export async function listAssignees ({ roles = [] }) {
  assertCanManage(ticketScopeFor({ roles }))
  return repo.assignables()
}

export async function reassign ({ roles = [], userId = null, ticketId, nuevoAsignadoId }) {
  assertCanManage(ticketScopeFor({ roles, userId }))

  const ticket = await repo.detail(ticketId)
  if (!ticket) throw new NotFoundError('Ticket no encontrado')

  const destino = await repo.assignableById(nuevoAsignadoId)
  assertReassignable(ticket, destino, nuevoAsignadoId)

  const anterior = ticket.asignado ?? 'sin asignar'
  await repo.reassign(ticketId, nuevoAsignadoId)

  const actualizado = await repo.detail(ticketId)
  // Mismo aviso que el escalamiento automatico: para quien lo lee en Slack es la
  // misma noticia (el ticket cambio de dueno), sin importar quien lo movio.
  void slack.notificarTicketEscalado(actualizado, anterior, 'Reasignación manual')

  return withSla(actualizado)
}

// ── Comentarios ────────────────────────────────────────────────────────────

export async function addComment ({ roles = [], userId = null, ticketId, cuerpo, archivos = [] }) {
  const scope = ticketScopeFor({ roles, userId })
  const ticket = await repo.detail(ticketId)
  if (!ticket) {
    await removeAttachments(archivos.map(a => a.stored_name))
    throw new NotFoundError('Ticket no encontrado')
  }

  try {
    assertCanComment(ticket, scope, userId)
    const texto = validateComment(cuerpo)
    await repo.createComment(ticketId, userId, texto, archivos)

    // Los comentarios del propio solicitante no se replican en su hilo: ya los
    // escribio el.
    if (ticket.created_by_id !== userId) {
      const autor = scope.canManage ? (ticket.asignado ?? 'Soporte') : 'Soporte'
      void slack.avisarComentarioNuevo(ticket, autor, texto)
    }
  } catch (err) {
    await removeAttachments(archivos.map(a => a.stored_name))
    throw err
  }

  return repo.comments(ticketId)
}

// ── Politicas de SLA ───────────────────────────────────────────────────────

export async function slaPolicies ({ roles = [] }) {
  assertCanManage(ticketScopeFor({ roles }))
  return repo.slaPolicies()
}

export async function saveSlaPolicy ({ roles = [], userId = null, prioridad, minutosPrimeraRespuesta, minutosResolucion }) {
  assertCanManage(ticketScopeFor({ roles, userId }))
  const datos = validateSlaPolicy({ prioridad, minutosPrimeraRespuesta, minutosResolucion })
  const guardada = await repo.saveSlaPolicy(datos, userId)
  if (!guardada) throw new NotFoundError('No existe una política para esa prioridad')
  return guardada
}

// ── Barrido del SLA (lo llama el cron) ─────────────────────────────────────

/**
 * Dos pasadas, en el orden del sistema origen:
 *
 *   1. Escalamiento: un ABIERTO que nadie tomo y cuya primera respuesta esta
 *      por vencer o vencio se reasigna a otro agente. UNA sola vez por ticket
 *      (escalated_at es el guard): si el segundo tampoco lo toma, insistir
 *      rotandolo no mejora nada y solo genera ruido.
 *
 *   2. Alertas: un aviso por ticket y por reloj. El sello se escribe SOLO si
 *      Slack confirmo, para que un webhook caido deje el aviso pendiente en vez
 *      de darlo por enviado.
 */
export async function runSlaSweep (ahora = new Date()) {
  const resultado = { escalados: 0, alertas: 0 }

  if (process.env.TICKETS_SLA_ESCALATION !== 'false') {
    resultado.escalados = await barrerEscalamientos(ahora)
  }
  // Sin webhook no hay a donde avisar: recorrer la BD para nada.
  if (slack.slackWebhookConfigurado()) {
    resultado.alertas = await barrerAlertas(ahora)
  }

  return resultado
}

async function barrerEscalamientos (ahora) {
  const candidatos = await repo.escalationCandidates()
  if (!candidatos.length) return 0

  let escalados = 0
  for (const ticket of candidatos) {
    const reloj = evaluarReloj(ticket.first_response_due_at, ticket.first_response_at, ticket.registration_date, ahora)
    if (reloj.estado !== 'POR_VENCER' && reloj.estado !== 'VENCIDO') continue

    const nuevo = pickAgent(await repo.agentCandidates(), ticket.assigned_to_id)
    if (nuevo === null) {
      // Un solo agente en el sistema: no hay a quien pasarselo. Se loguea y se
      // reintenta en la proxima corrida, por si alguien mas entra de guardia.
      console.warn(`[tickets-sla] ticket #${formatTicketCode(ticket.ticket_id)} sin otro agente disponible para escalar`)
      continue
    }

    // El nombre del agente anterior se lee ANTES del update: despues la fila ya
    // tiene al nuevo y el aviso diria que se lo reasignaron a si mismo.
    const anterior = (await repo.detail(ticket.ticket_id))?.asignado ?? 'sin asignar'
    await repo.applyEscalation(ticket.ticket_id, nuevo, ticket.assigned_to_id, ahora)
    escalados++

    const actualizado = await repo.detail(ticket.ticket_id)
    void slack.notificarTicketEscalado(actualizado, anterior, 'Escalamiento automático por SLA')
  }
  return escalados
}

async function barrerAlertas (ahora) {
  const pendientes = await repo.overdueClocks(ahora)
  let enviadas = 0

  for (const ticket of pendientes) {
    const relojes = [
      { nombre: 'respuesta', vence: ticket.first_response_due_at, cumplido: ticket.first_response_at, avisado: ticket.response_alert_sent_at },
      { nombre: 'resolucion', vence: ticket.resolution_due_at, cumplido: ticket.resolved_at, avisado: ticket.resolution_alert_sent_at }
    ]

    for (const reloj of relojes) {
      if (!reloj.vence || reloj.cumplido || reloj.avisado) continue
      if (new Date(reloj.vence) >= ahora) continue

      const llego = await slack.notificarSlaIncumplido(ticket, reloj.nombre, reloj.vence)
      if (!llego) continue

      await repo.sealAlert(ticket.ticket_id, reloj.nombre, ahora)
      enviadas++
    }
  }
  return enviadas
}

// ── Slash command de Slack ─────────────────────────────────────────────────

/**
 * Crea un ticket en nombre de quien escribio /ticket. La identidad se resuelve
 * por email: Slack -> users.info -> public.users. Si no hay match, quien
 * pregunta se entera por que, no con un error generico.
 */
export async function createTicketFromSlack ({ slackUserId, titulo, problema, link }) {
  const email = slackUserId ? await slack.obtenerEmailDeUsuarioSlack(slackUserId) : null
  if (!email) {
    throw new DomainError('No pudimos leer tu email de Slack. Crea el ticket desde el ERP.')
  }

  const usuario = await repo.findActiveUserByEmail(email)
  if (!usuario) {
    throw new DomainError(`No encontramos una cuenta activa del ERP con el correo ${email}. Crea el ticket desde el ERP o avisa a soporte.`)
  }

  return createTicket({ userId: usuario.user_id, titulo, problema, link, archivos: [], slackUserId })
}
