import { consultarAvanceDesdeSlack } from '../tickets.usecases.js'
import { formatTicketCode } from '../tickets.entity.js'
import { postearMensaje } from '../../../shared/adapters/slack/tickets-slack.adapter.js'
import { limpiarTextoSlack, recortar } from './slack.text.js'
import { interpretarMensaje } from './slack.ai.js'
import { bloquesDeBorrador, bloquesDeTextoPlano } from './slack.blocks.js'

// Events API: el bot escucha `message.im`, o sea los DM que le escriben.
//
// Reemplaza a /Crearticket como via principal. Ya no hay formato que aprender
// ni separadores que respetar: se escribe el problema como se le contaria a un
// companero, la IA lo lee, y el bot devuelve un borrador con dos botones.
//
// Scopes que necesita la app en Slack: im:history, im:read, chat:write y
// users:read.email. Y en "Event Subscriptions", la suscripcion a message.im.

// Tope de la columna problem en la entity. Se recorta aca para que el borrador
// muestre exactamente lo que se va a guardar, y no prometa un texto que la
// validacion despues rechazaria entero.
const PROBLEMA_MAX = 2000
const PROBLEMA_MIN = 10

const RESPUESTA_OTRO =
  '💬 Por acá solo creo *tickets nuevos*.\n' +
  'Los comentarios y respuestas van dentro del ERP, en el ticket que corresponda.'

const RESPUESTA_CORTO =
  '🤔 Con eso no me alcanza para abrir un ticket.\n' +
  'Cuéntame qué pasó, dónde te pasó y qué esperabas que ocurriera.'

const RESPUESTA_SIN_ACTIVOS =
  '📭 No tienes tickets activos ahora mismo.\n' +
  'Si algo dejó de funcionar, escríbeme de qué se trata y te abro uno.'

const ESTADO_LEGIBLE = {
  ABIERTO: '🆕 Abierto, esperando que lo tomen',
  EN_PROGRESO: '👀 En progreso',
  CERRADO: '✅ Cerrado'
}

// ── Deduplicacion ──────────────────────────────────────────────────────────
//
// Slack reintenta un evento hasta 3 veces si el ACK no llega a tiempo, y el ACK
// sale antes de que el trabajo termine: sin esto, un pico de latencia crea el
// mismo borrador tres veces. Se guarda el event_id, que es estable entre
// reintentos.
//
// En memoria a proposito: son 5 minutos de ids, el reintento de Slack ocurre
// dentro de esa ventana, y lo que protege ademas es el header de retry. Una
// tabla para esto seria mas maquinaria que problema.
const VENTANA_MS = 5 * 60 * 1000
const vistos = new Map()

export function yaProcesado (eventId) {
  if (!eventId) return false

  const ahora = Date.now()
  for (const [id, cuando] of vistos) {
    if (ahora - cuando > VENTANA_MS) vistos.delete(id)
  }

  if (vistos.has(eventId)) return true
  vistos.set(eventId, ahora)
  return false
}

/**
 * ¿Este evento es un DM de una persona, escrito ahora?
 *
 * El filtro mas importante es el del propio bot: el bot contesta en el mismo
 * DM que escucha, asi que sin descartar sus mensajes se responderia a si mismo
 * en un bucle infinito.
 */
export function esDmDePersona (evento) {
  if (!evento || evento.type !== 'message') return false
  if (evento.channel_type !== 'im') return false
  if (evento.bot_id || evento.subtype) return false // ediciones, borrados y bots
  if (evento.thread_ts && evento.thread_ts !== evento.ts) return false // hilo de un ticket
  if (!evento.user || !evento.channel) return false
  return Boolean(String(evento.text ?? '').trim())
}

export function eventsHandler (req, reply) {
  const body = req.body ?? {}

  // Alta del endpoint en la consola de Slack: contesta el challenge y ya.
  if (body.type === 'url_verification') {
    return reply.code(200).send({ challenge: body.challenge })
  }

  // Slack exige el ACK en 3 s y aca hay que llamar a Gemini y a su Web API.
  // Se responde primero y se trabaja despues; el resultado llega como un
  // mensaje nuevo al DM, no como respuesta de este request.
  reply.code(200).send({ ok: true })

  // Un reintento significa que el ACK original se perdio, pero el trabajo pudo
  // haber salido igual. Se descarta: duplicar un ticket es peor que perder un
  // aviso que el usuario puede repetir.
  if (req.headers['x-slack-retry-num']) return

  const evento = body.event
  if (body.type !== 'event_callback' || !esDmDePersona(evento)) return
  if (yaProcesado(body.event_id)) return

  void procesarDm(evento)
}

async function procesarDm (evento) {
  const canal = evento.channel
  const { texto, enlaces } = limpiarTextoSlack(evento.text)

  try {
    const { intencion, titulo, ticketRef } = await interpretarMensaje(texto)

    if (intencion === 'OTRO') {
      await postearMensaje(canal, bloquesDeTextoPlano(RESPUESTA_OTRO))
      return
    }

    if (intencion === 'AVANCE') {
      await postearMensaje(canal, bloquesDeTextoPlano(await textoDeAvance(evento.user, ticketRef)))
      return
    }

    // Un "no anda nada" no da para un ticket que alguien pueda atender.
    if (texto.length < PROBLEMA_MIN) {
      await postearMensaje(canal, bloquesDeTextoPlano(RESPUESTA_CORTO))
      return
    }

    await postearMensaje(canal, bloquesDeBorrador({
      titulo,
      problema: recortar(texto, PROBLEMA_MAX),
      enlaces
    }))
  } catch (err) {
    await postearMensaje(canal, bloquesDeTextoPlano(mensajeDeError(err, '[tickets-slack] DM')))
  }
}

/**
 * El avance sale de la BD y se arma con plantilla. La IA no participa: no
 * redacta el estado (tokens de salida por algo que ya esta escrito) ni podria
 * inventarse una fecha que el usuario va a tomar por cierta.
 */
async function textoDeAvance (slackUserId, ticketRef) {
  const { ticket, activos } = await consultarAvanceDesdeSlack({ slackUserId, ticketRef })

  if (ticketRef && !ticket) {
    return `🔍 No encontré el ticket #${formatTicketCode(ticketRef)} entre los tuyos.\n` +
      'Revisa el número, o escríbeme "mis tickets" para ver los que tienes abiertos.'
  }

  if (ticket) {
    const lineas = [
      `*Ticket #${formatTicketCode(ticket.ticket_id)}* — ${ticket.title}`,
      `*Estado:* ${ESTADO_LEGIBLE[ticket.status] ?? ticket.status}`,
      `*Prioridad:* ${ticket.priority}`,
      `*Atiende:* ${ticket.asignado ?? 'aún sin asignar'}`
    ]
    if (ticket.comentarios > 0) {
      lineas.push(`*Comentarios:* ${ticket.comentarios} (se leen y responden en el ERP)`)
    }
    return lineas.join('\n')
  }

  if (!activos.length) return RESPUESTA_SIN_ACTIVOS

  const filas = activos.map(t =>
    `• *#${formatTicketCode(t.ticket_id)}* — ${t.title} _(${ESTADO_LEGIBLE[t.status] ?? t.status})_`)
  return [`📋 Tienes ${activos.length} ticket(s) activo(s):`, ...filas].join('\n')
}

/**
 * Un DomainError trae un mensaje escrito para leerse (no hay cuenta en el ERP,
 * no hay agentes...); cualquier otra cosa se enmascara y se queda en el log.
 * Mismo criterio que el slash command.
 */
export function mensajeDeError (err, etiqueta) {
  if (err?.expose) return `❌ ${err.message}`
  console.error(`${etiqueta}:`, err)
  return '❌ Se me complicó procesar tu mensaje. Inténtalo de nuevo en un momento.'
}
