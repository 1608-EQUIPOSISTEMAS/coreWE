import { consultarAvanceDesdeSlack, createTicketFromSlack } from '../tickets.usecases.js'
import { escaparSlack } from './slack.text.js'
import { formatTicketCode } from '../tickets.entity.js'
import { postearMensaje, leerHistorialDm } from '../../../shared/adapters/slack/tickets-slack.adapter.js'
import { interpretarConversacion } from './slack.ai.js'
import { bloquesDePreguntas, bloquesDeTextoPlano } from './slack.blocks.js'
import {
  MAX_RONDAS, PROBLEMA_MIN, archivosDelMensaje, armarBorrador, enlacesYArchivos,
  reconstruirConversacion, textoDelUsuario, turnoDeMensaje
} from './slack.conversacion.js'
import { textoDeEstado, ESTADO_LEGIBLE } from './slack.estado.js'
import { mensajeDeError } from './slack.errores.js'

export { mensajeDeError }

// Events API: el bot escucha `message.im`, o sea los DM que le escriben.
//
// Es la unica via de alta desde Slack. No hay formato que aprender
// ni separadores que respetar: se escribe el problema como se le contaria a un
// companero y la IA lo lee. Si al reporte le falta algo para poder atenderlo,
// el bot pregunta (hasta MAX_RONDAS veces, ver slack.conversacion.js). El
// ticket se crea solo, sin botones ni confirmacion: en cuanto el reporte queda
// completo, o si ya no hay mas preguntas que hacer (se agotaron las rondas, o
// no hay IA para proponerlas), se crea con lo que haya.
//
// Scopes que necesita la app en Slack: im:history, im:read, chat:write,
// users:read.email y files:read (imagenes adjuntas). Y en "Event
// Subscriptions", la suscripcion a message.im.

// La gente escribe en rafagas: "hola", y despues el problema; o el problema y
// despues la captura. Cada mensaje espera un momento antes de procesarse, y si
// llega otro del mismo DM, el anterior se cancela: el ultimo lee del historial
// todo lo que quedo pendiente y contesta una sola vez.
const ESPERA_MS = Number(process.env.TICKETS_SLACK_ESPERA_MS ?? 2500)
const enEspera = new Map()

const RESPUESTA_OTRO =
  '💬 Por acá solo creo *tickets nuevos*.\n' +
  'Los comentarios y respuestas van dentro del ERP, en el ticket que corresponda.'

const RESPUESTA_CORTO =
  '🤔 Con eso no me alcanza para abrir un ticket.\n' +
  'Cuéntame qué pasó, dónde te pasó y qué esperabas que ocurriera.'

const RESPUESTA_SOLO_ARCHIVOS =
  '🖼️ Recibí tus archivos, pero me falta saber qué pasó.\n' +
  'Envíame en un solo mensaje la descripción del problema junto con las imágenes y te armo el ticket.'


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
  if (evento.bot_id) return false
  // Ediciones, borrados y bots traen subtype; un mensaje con imagenes adjuntas
  // llega como file_share y SI es de una persona (antes se descartaba, y por eso
  // un DM con capturas nunca ofrecia crear el ticket).
  if (evento.subtype && evento.subtype !== 'file_share') return false
  if (evento.thread_ts && evento.thread_ts !== evento.ts) return false // hilo de un ticket
  if (!evento.user || !evento.channel) return false
  return Boolean(String(evento.text ?? '').trim()) || archivosDelEvento(evento).length > 0
}

/** Los adjuntos del DM que el ticket acepta (mismos tipos y peso que la web). */
export const archivosDelEvento = archivosDelMensaje

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

  clearTimeout(enEspera.get(evento.channel))
  enEspera.set(evento.channel, setTimeout(() => {
    enEspera.delete(evento.channel)
    void procesarDm(evento)
  }, ESPERA_MS))
}

async function procesarDm (evento) {
  const canal = evento.channel

  // Lo que el usuario escribio antes en este DM: las respuestas a una ronda de
  // preguntas en curso, o mensajes sueltos que todavia no tuvieron respuesta.
  // Sin historial (falta el scope, Slack caido) se sigue solo con este mensaje.
  const previos = await leerHistorialDm(canal, { antesDe: evento.ts })
  const { ronda, inicio, turnos: anteriores } = reconstruirConversacion(previos ?? [], evento.ts)
  const turnos = [...anteriores, turnoDeMensaje(evento)]
  const enEntrevista = ronda > 0
  const texto = textoDelUsuario(turnos)

  // Solo imagenes, sin contar que paso: no hay ticket que armar todavia. En
  // medio de la entrevista si vale: puede ser la captura que se le pidio.
  if (!enEntrevista && enlacesYArchivos(turnos).archivos.length && texto.length < PROBLEMA_MIN) {
    await postearMensaje(canal, bloquesDeTextoPlano(RESPUESTA_SOLO_ARCHIVOS))
    return
  }

  try {
    // Sin historial no hay como releer las respuestas despues: no se pregunta.
    const permitirPreguntas = previos !== null && ronda < MAX_RONDAS
    const { intencion, titulo, ticketRef, preguntas, completo } = await interpretarConversacion(turnos, { permitirPreguntas })

    // Dentro de una entrevista el mensaje es una respuesta, diga lo que diga:
    // "no se" o "gracias" no la cortan, siguen hacia el borrador.
    if (!enEntrevista) {
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
    }

    if (preguntas.length) {
      await postearMensaje(canal, bloquesDePreguntas({ preguntas, ronda: ronda + 1, inicio: inicio ?? evento.ts }))
      return
    }

    // Sin preguntas pendientes ya no hay nada que esperar: completo porque
    // cubre los tres puntos, o incompleto porque se agotaron las rondas (o no
    // hay IA para proponer mas). En ambos casos el ticket se crea con lo que
    // haya, sin botones ni confirmacion.
    const borrador = armarBorrador(turnos, titulo)
    const ticket = await createTicketFromSlack({
      slackUserId: evento.user,
      titulo: borrador.titulo,
      problema: borrador.problema,
      link: borrador.enlaces.join('\n') || null,
      archivosSlack: borrador.archivos.map(a => a.id)
    })

    const mensajeFinal = completo
      ? `✅ Con eso ya tengo todo lo necesario. Creé tu ticket *#${formatTicketCode(ticket.ticket_id)}* — ${escaparSlack(ticket.title)}.`
      : `✅ Creé tu ticket *#${formatTicketCode(ticket.ticket_id)}* — ${escaparSlack(ticket.title)}. Si falta algo, cuéntamelo y lo agrego desde el ERP.`
    await postearMensaje(canal, bloquesDeTextoPlano(mensajeFinal))
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
      `*Ticket #${formatTicketCode(ticket.ticket_id)}* — ${escaparSlack(ticket.title)}`,
      `*Estado:* ${ESTADO_LEGIBLE[ticket.status] ?? ticket.status}`,
      `*Prioridad:* ${ticket.priority}`,
      `*Atiende:* ${escaparSlack(ticket.asignado ?? 'aún sin asignar')}`
    ]
    if (ticket.comentarios > 0) {
      lineas.push(`*Comentarios:* ${ticket.comentarios} (se leen y responden en el ERP)`)
    }
    return lineas.join('\n')
  }

  // Sin numero: la lista de sus tickets abiertos.
  return textoDeEstado(activos)
}
