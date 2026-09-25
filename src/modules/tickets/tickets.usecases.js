import { ticketsRepository } from './tickets.repository.js'
import { clasificarPrioridad, plazosSla } from './tickets.priority.js'
import {
  ticketScopeFor, assertCanRead, assertCanComment, assertCanManage,
  nextStatus, pickAgent, assertReassignable, isTakeable, canChangeStatusOf,
  canReopenOf, reopenByReporter,
  validateTicketInput, validateComment,
  computeDueDates, withSla, applyFilter, buildKpis, formatTicketCode, ticketAreaLabel,
  ESTADOS_ACTIVOS
} from './tickets.entity.js'
import { evaluarReloj } from '../../shared/sla/sla-clock.js'
import { DomainError, NotFoundError } from '../../shared/errors.js'
import { removeAttachments, guardarAdjunto, MAX_FILES, MAX_BYTES } from './tickets.files.js'
import * as slack from '../../shared/adapters/slack/tickets-slack.adapter.js'
import { startTicketNote, getTicketNote } from './ai-note/ticket-ai.usecases.js'

// Orquestacion: consulta al repositorio, decide con la entity y dispara los
// efectos externos. Los avisos a Slack van siempre con `void`: no suman latencia
// a la respuesta y un webhook caido no puede voltear algo ya guardado en la BD.

const repo = ticketsRepository

// Ventana de gracia antes del reparto automatico: nace sin asignar para que un
// admin lo pueda tomar a mano (vía "Reasignar a", que ya acepta un ticket sin
// dueño) antes de que el cron lo reparta solo. 2 a 3 min de margen real.
const AUTOASSIGN_ESPERA_MINUTOS = Number(process.env.TICKETS_AUTOASSIGN_MINUTOS ?? 3)

// Puertos que cablea buildApp.js. `publicarCambio` avisa en tiempo real (SSE)
// a las pantallas abiertas que un ticket cambio, para que se refresquen solas:
// sin esto, un ticket creado por DM de Slack o repartido por el cron solo
// aparecia al recargar la pagina.
const _ports = {
  publicarCambio: async () => {}
}
export function setTicketsPorts (ports) { Object.assign(_ports, ports) }

// Best-effort: el aviso no puede voltear algo ya guardado en la BD.
function avisarCambio (ticketId) {
  Promise.resolve()
    .then(() => _ports.publicarCambio({ tipo_evento: 'tickets_actualizados', ticket_id: ticketId }))
    .catch(err => console.error('[tickets] aviso en vivo fallo:', err.message))
}

// ── Lectura ────────────────────────────────────────────────────────────────

export async function listTickets ({ roles = [], userId = null, filtro = 'TODOS', busqueda = '', orden = 'sla' } = {}) {
  const scope = ticketScopeFor({ roles, userId })
  const ahora = new Date()

  const rows = (await repo.list(scope, { busqueda, orden })).map(r => ({
    ...withSla(r, ahora),
    // Por fila: la bandeja ofrece "Tomar" sin entrar al detalle.
    canChangeStatus: canChangeStatusOf(r, scope, userId)
  }))

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
  return conDetalle(ticket, scope, userId)
}

/**
 * El ticket tal como lo pinta la pagina de detalle. Lo devuelven TAMBIEN las
 * mutaciones (estado, reasignacion): si respondieran solo la fila, el front
 * perderia los permisos y los adjuntos y habria que recargar para verlos.
 */
async function conDetalle (ticket, scope, userId, ahora = new Date()) {
  return {
    ...withSla(ticket, ahora),
    // El listado solo necesita cuantos hay; el detalle, cuales son.
    adjuntosLista: await repo.attachmentsOf(ticket.ticket_id),
    canManage: scope.canManage,
    // Mover el estado exige ser el agente asignado (o tomar uno sin dueño),
    // no solo ser ADMIN.
    canChangeStatus: canChangeStatusOf(ticket, scope, userId),
    // Quien reporto puede reabrir lo suyo sin ser ADMIN.
    canReopen: canReopenOf(ticket, userId)
  }
}

// Nota IA del ticket, con el mismo permiso de lectura que el detalle.
export async function ticketAiNote ({ roles = [], userId = null, ticketId }) {
  const scope = ticketScopeFor({ roles, userId })
  const ticket = await repo.detail(ticketId)
  if (!ticket) throw new NotFoundError('Ticket no encontrado')
  assertCanRead(ticket, scope, userId)
  return getTicketNote({
    ticket: { ...ticket, area: ticketAreaLabel(ticket.creador_roles) },
    canManage: scope.canManage
  })
}

// Pestaña "Actividad": mismo permiso de lectura que el detalle.
export async function ticketActivity ({ roles = [], userId = null, ticketId }) {
  const scope = ticketScopeFor({ roles, userId })
  const ticket = await repo.detail(ticketId)
  if (!ticket) throw new NotFoundError('Ticket no encontrado')
  assertCanRead(ticket, scope, userId)
  return repo.activity(ticketId)
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
 * Alta de ticket. Mismo camino para la web y para el DM al bot de Slack:
 * validar, clasificar la prioridad, congelar los plazos (tabla de SLA de
 * criterios-prioridad.md, en horario habil) y dejarlo SIN asignar unos minutos (ver AUTOASSIGN_ESPERA_MINUTOS):
 * nace abierto y sin dueño a proposito, para que un admin lo pueda tomar a
 * mano dentro de la ventana de gracia antes de que el reparto automatico entre
 * a jugar (tickets-autoassign.cron.js).
 */
export async function createTicket ({ userId, titulo, problema, link, archivos = [], slackUserId = null }) {
  const datos = validateTicketInput({ titulo, problema, link })

  // La prioridad la decide el contenido, no quien reporta.
  const priority = clasificarPrioridad(datos.titulo, datos.problema)

  // registration_date explicito (y no el default de la BD) para que ambos
  // relojes cuenten desde exactamente el mismo instante que queda en la fila.
  const registrationDate = new Date()
  const vencimientos = computeDueDates(plazosSla(priority), registrationDate)

  // No se asigna aca: solo se comprueba que exista AL MENOS un agente, para no
  // dejar el ticket huerfano para siempre si el sistema no tiene a quien
  // repartirselo. 503 y no 500: no hay nada roto, no hay a quien asignarlo.
  const hayAgentes = (await repo.agentCandidates()).length > 0
  if (!hayAgentes) {
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
      assigned_to_id: null,
      registration_date: registrationDate,
      ...vencimientos
    }, archivos)
  } catch (err) {
    // La transaccion se deshizo sola; lo que queda huerfano es el disco.
    await removeAttachments(archivos.map(a => a.stored_name))
    throw err
  }

  const ticket = await repo.detail(ticketId)
  avisarCambio(ticketId)
  // El area no viaja en la fila: se calcula aca (mismo dato que ya trae
  // creador_roles) para que el adaptador de Slack no tenga que conocer el
  // organigrama del ERP.
  void slack.notificarTicketCreado({ ...ticket, area: ticketAreaLabel(ticket.creador_roles) })
  // Aviso plano aparte: es el que de verdad le importa a un admin de guardia
  // ("andate corriendo a tomarlo"), no el resumen completo de arriba.
  void slack.notificarEsperandoAsignacion(ticket, AUTOASSIGN_ESPERA_MINUTOS)

  // El borrador del DM se reemplaza al crear: se confirma con un mensaje propio
  // y se guarda el canal del DM, donde llegan los avances como mensajes nuevos.
  if (slackUserId) void abrirSeguimiento(ticket, slackUserId)

  // Nota IA (resumen, datos que faltan, borrador de respuesta) en segundo
  // plano: el modelo local tarda ~30 s y el ticket ya quedo creado.
  void startTicketNote({ ...ticket, area: ticketAreaLabel(ticket.creador_roles) })

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

  // Se lee ANTES del update: despues de guardar el estado previo ya no esta.
  const reabriendo = ticket.status === 'CERRADO' && estado === 'EN_PROGRESO'
  // Tomar un ABIERTO sin dueño lo asigna a quien lo toma (antes habia que
  // reasignarselo a uno mismo desde el detalle y recien ahi tomarlo).
  const reclamando = estado === 'EN_PROGRESO' && isTakeable(ticket)

  const ahora = new Date()
  // nextStatus valida con el dueño que va a quedar, antes de tocar nada.
  const cambios = nextStatus(reclamando ? { ...ticket, assigned_to_id: userId } : ticket, userId, estado, ahora)

  if (reclamando && !(await repo.claim(ticketId, userId))) {
    throw new DomainError('Otro agente acaba de tomar este ticket', { statusCode: 409, code: 'TICKET_YA_TOMADO' })
  }
  await repo.updateStatus(ticketId, cambios)

  const actualizado = await repo.detail(ticketId)
  avisarCambio(ticketId)
  const agente = actualizado.asignado ?? 'Soporte'
  let avisoSlack = null

  if (reabriendo) {
    void slack.notificarTicketReabierto(actualizado)
  } else if (estado === 'CERRADO') {
    // Unico punto por el que un ticket llega a CERRADO: lo garantiza nextStatus.
    void slack.notificarTicketCerrado(actualizado)
    // Se espera (timeout de 5 s del adaptador) para decirle al agente si la
    // confirmacion le llego a quien reporto; un fallo no deshace el cierre.
    try {
      avisoSlack = Boolean(await slack.avisarTicketResuelto(actualizado, agente))
    } catch {
      avisoSlack = false
    }
  } else {
    void slack.avisarTicketTomado(actualizado, agente)
  }

  return { ...(await conDetalle(actualizado, scope, userId, ahora)), avisoSlack }
}

/**
 * Reabrir desde quien reporto ("el problema sigue"). No pasa por
 * assertCanManage: el permiso es ser el creador, no ser ADMIN. El ticket vuelve
 * a EN_PROGRESO con el mismo agente, que se entera por el aviso de Slack.
 */
export async function reopenTicket ({ roles = [], userId = null, ticketId }) {
  const scope = ticketScopeFor({ roles, userId })
  const ticket = await repo.detail(ticketId)
  if (!ticket) throw new NotFoundError('Ticket no encontrado')

  await repo.updateStatus(ticketId, reopenByReporter(ticket, userId))

  const actualizado = await repo.detail(ticketId)
  avisarCambio(ticketId)
  void slack.notificarTicketReabierto(actualizado)
  return conDetalle(actualizado, scope, userId)
}

export async function listAssignees ({ roles = [] }) {
  assertCanManage(ticketScopeFor({ roles }))
  return repo.assignables()
}

export async function reassign ({ roles = [], userId = null, ticketId, nuevoAsignadoId }) {
  const scope = assertCanManage(ticketScopeFor({ roles, userId }))

  const ticket = await repo.detail(ticketId)
  if (!ticket) throw new NotFoundError('Ticket no encontrado')

  const destino = await repo.assignableById(nuevoAsignadoId)
  assertReassignable(ticket, destino, nuevoAsignadoId)

  const anterior = ticket.asignado ?? 'sin asignar'
  await repo.reassign(ticketId, nuevoAsignadoId)

  const actualizado = await repo.detail(ticketId)
  avisarCambio(ticketId)
  // Mismo aviso que el escalamiento automatico: para quien lo lee en Slack es la
  // misma noticia (el ticket cambio de dueno), sin importar quien lo movio.
  void slack.notificarTicketEscalado(actualizado, anterior, 'Reasignación manual')
  void slack.avisarTicketReasignado(actualizado, actualizado.asignado ?? 'Soporte', {
    primeraAsignacion: !ticket.assigned_to_id,
  })

  return conDetalle(actualizado, scope, userId)
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
    avisarCambio(ticketId)

    // Los comentarios del propio solicitante no se replican en su DM: ya los
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

// ── Reparto automatico diferido (lo llama tickets-autoassign.cron.js) ──────

/**
 * Pasado AUTOASSIGN_ESPERA_MINUTOS desde que se creo, un ABIERTO que sigue sin
 * asignar entra al reparto automatico de siempre (pickAgent). Si nadie lo tomo
 * a mano en la ventana de gracia, esto es lo que hace que no se quede huerfano.
 */
export async function runAutoAssignSweep (ahora = new Date()) {
  const cutoff = new Date(ahora.getTime() - AUTOASSIGN_ESPERA_MINUTOS * 60_000)
  const pendientes = await repo.unassignedOlderThan(cutoff)
  if (!pendientes.length) return 0

  let asignados = 0
  for (const ticket of pendientes) {
    const nuevo = pickAgent(await repo.agentCandidates())
    if (nuevo === null) {
      // Sin agentes: se reintenta en la proxima corrida, por si alguien se
      // activa mientras tanto.
      console.warn(`[tickets-autoassign] ticket #${formatTicketCode(ticket.ticket_id)} sigue sin agentes disponibles`)
      continue
    }

    await repo.reassign(ticket.ticket_id, nuevo)
    asignados++
    avisarCambio(ticket.ticket_id)

    const actualizado = await repo.detail(ticket.ticket_id)
    // Mismo aviso que el escalamiento por SLA: para quien lo lee es la misma
    // noticia (el ticket tiene dueño), sin importar por que camino llego.
    void slack.notificarTicketEscalado(actualizado, 'sin asignar', 'Asignación automática (venció la ventana de gracia)')
    void slack.avisarTicketReasignado(actualizado, actualizado.asignado ?? 'Soporte', { primeraAsignacion: true })
  }
  return asignados
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
    avisarCambio(ticket.ticket_id)

    const actualizado = await repo.detail(ticket.ticket_id)
    void slack.notificarTicketEscalado(actualizado, anterior, 'Escalamiento automático por SLA')
    void slack.avisarTicketReasignado(actualizado, actualizado.asignado ?? 'Soporte')
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

// ── Bot de Slack por DM ────────────────────────────────────────────────────

/**
 * Crea un ticket en nombre de quien le escribio al bot (boton "Crear ticket"
 * del borrador). La identidad se resuelve
 * por email: Slack -> users.info -> public.users. Si no hay match, quien
 * pregunta se entera por que, no con un error generico.
 */
export async function createTicketFromSlack ({ slackUserId, titulo, problema, link, archivosSlack = [] }) {
  const usuario = await resolverUsuarioDeSlack(slackUserId)
  const archivos = await bajarArchivosDeSlack(archivosSlack)
  // createTicket ya borra del disco los adjuntos si el alta falla.
  return createTicket({ userId: usuario.user_id, titulo, problema, link, archivos, slackUserId })
}

/**
 * Las imagenes del DM, bajadas de Slack y validadas igual que las de la web.
 * Una que no se pueda bajar o no pase la validacion se omite: perder una
 * captura es mejor que no crear el ticket.
 */
async function bajarArchivosDeSlack (fileIds = []) {
  const archivos = []
  for (const id of fileIds.slice(0, MAX_FILES)) {
    const bajado = await slack.descargarArchivoSlack(id, MAX_BYTES)
    if (!bajado) continue
    try {
      archivos.push(await guardarAdjunto(bajado.buffer, bajado.mimeType, bajado.nombre))
    } catch (err) {
      console.warn(`[tickets] adjunto de Slack ${id} descartado: ${err.message}`)
    }
  }
  return archivos
}

/**
 * Del user_id de Slack a la cuenta del ERP, cruzando por email. Es el unico
 * puente entre las dos identidades: Slack no conoce el user_id del ERP y el
 * payload del evento solo trae el suyo.
 */
export async function resolverUsuarioDeSlack (slackUserId) {
  const email = slackUserId ? await slack.obtenerEmailDeUsuarioSlack(slackUserId) : null
  if (!email) {
    throw new DomainError('No pudimos leer tu email de Slack. Crea el ticket desde el ERP.')
  }

  const usuario = await repo.findActiveUserByEmail(email)
  if (!usuario) {
    throw new DomainError(`No encontramos una cuenta activa del ERP con el correo ${email}. Crea el ticket desde el ERP o avisa a soporte.`)
  }

  return usuario
}

/**
 * Los tickets que este usuario de Slack puede consultar por DM.
 *
 * Alcance deliberadamente mas estrecho que el de la web: por DM cada quien ve
 * lo SUYO y nada mas, aunque en el ERP sea lider o gerencia. El canal privado
 * de un bot no es el lugar para asomarse al area entera, y la bandeja completa
 * ya esta a un clic en el ERP.
 *
 * Con `ticketRef` responde por ese ticket (null si no existe o no es suyo); sin
 * el, devuelve los activos, del mas urgente al menos.
 */
export async function consultarAvanceDesdeSlack ({ slackUserId, ticketRef = null }) {
  const usuario = await resolverUsuarioDeSlack(slackUserId)
  const ahora = new Date()

  if (ticketRef) {
    const fila = await repo.detail(ticketRef)
    // Mismo criterio que canRead para un scope OWN, escrito aca porque el
    // usuario de Slack no llega con sus roles cargados.
    if (!fila || fila.created_by_id !== usuario.user_id) return { ticket: null, activos: [] }
    return { ticket: withSla(fila, ahora), activos: [] }
  }

  const filas = await repo.list({ areaRoles: null, userId: usuario.user_id })
  const activos = filas
    .filter(f => ESTADOS_ACTIVOS.includes(f.status))
    .map(f => withSla(f, ahora))

  return { ticket: null, activos }
}
