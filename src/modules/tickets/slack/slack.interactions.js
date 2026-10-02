import { createTicketFromSlack, responderManualDesdeSlack } from '../tickets.usecases.js'
import { formatTicketCode } from '../tickets.entity.js'
import {
  reemplazarMensaje, reemplazarMensajeConBloques, leerHistorialDm
} from '../../../shared/adapters/slack/tickets-slack.adapter.js'
import {
  ACCION_CREAR, ACCION_DESCARTAR, ACCION_OMITIR, ACCION_MANUAL_SI, ACCION_MANUAL_NO,
  bloquesDeBorrador, leerBorrador, leerTicketDeManual
} from './slack.blocks.js'
import { armarBorrador, parsearEstado, turnosDesde } from './slack.conversacion.js'
import { interpretarConversacion } from './slack.ai.js'
import { yaProcesado, mensajeDeError } from './slack.events.js'

const ACCIONES = [ACCION_CREAR, ACCION_DESCARTAR, ACCION_OMITIR, ACCION_MANUAL_SI, ACCION_MANUAL_NO]

// Los dos botones del borrador, el de "armarlo con lo que hay" de las
// preguntas previas y el "Si / No" del manual enviado como solucion. Slack
// manda estas interacciones como x-www-form-urlencoded con un unico campo
// `payload` que trae el JSON (parser de slack.verify.js), y la firma se
// verifica igual que en los eventos.
//
// En la consola de Slack se configura en "Interactivity & Shortcuts" apuntando
// a esta ruta.

const DESCARTADO = '🗑️ Listo, no creé nada. Si lo necesitas más adelante, vuelve a escribirme.'
const BORRADOR_VIEJO =
  '⚠️ No pude recuperar este borrador (probablemente es de antes del último despliegue).\n' +
  'Vuelve a escribirme el problema y te armo uno nuevo.'
const CONVERSACION_PERDIDA =
  '⚠️ No pude releer nuestra conversación.\n' +
  'Vuelve a escribirme el problema en un solo mensaje y te armo el ticket.'

export function interactionsHandler (req, reply) {
  // Slack corta a los 3 s igual que en los eventos, y crear el ticket encadena
  // users.info + insert + el DM de apertura.
  reply.code(200).send()

  let payload
  try {
    payload = JSON.parse(req.body?.payload ?? '')
  } catch {
    return
  }

  if (payload?.type !== 'block_actions') return

  const accion = payload.actions?.[0]?.action_id
  if (!ACCIONES.includes(accion)) return

  // Doble clic sobre el mismo borrador: el ts del mensaje lo identifica. Sin
  // esto, dos toques seguidos al boton crean dos tickets iguales. Va con la
  // accion porque un mismo mensaje pasa de preguntas a borrador (mismo ts) y
  // ahi el Crear tiene que seguir funcionando.
  if (yaProcesado(`${accion}:${payload.message?.ts}`)) return

  void resolver(accion, payload)
}

async function resolver (accion, payload) {
  const responseUrl = payload.response_url
  if (!responseUrl) return

  if (accion === ACCION_DESCARTAR) {
    await reemplazarMensaje(responseUrl, DESCARTADO)
    return
  }

  if (accion === ACCION_OMITIR) {
    await armarConLoQueHay(payload)
    return
  }

  if (accion === ACCION_MANUAL_SI || accion === ACCION_MANUAL_NO) {
    await responderManual(payload, accion === ACCION_MANUAL_SI)
    return
  }

  const borrador = leerBorrador(payload.message?.blocks)
  if (!borrador) {
    await reemplazarMensaje(responseUrl, BORRADOR_VIEJO)
    return
  }

  try {
    const ticket = await createTicketFromSlack({
      slackUserId: payload.user?.id,
      titulo: borrador.titulo,
      problema: borrador.problema,
      link: borrador.link,
      archivosSlack: borrador.archivos
    })
    // La confirmacion con prioridad y enlace llega aparte: createTicket la
    // publica en este mismo DM, donde despues van llegando los avances. Aca
    // solo se cierra el borrador con el numero.
    await reemplazarMensaje(responseUrl,
      `✅ Tu ticket fue creado correctamente. Número: *#${formatTicketCode(ticket.ticket_id)}*.`)
  } catch (err) {
    await reemplazarMensaje(responseUrl, mensajeDeError(err, '[tickets-slack] botón crear'))
  }
}

/**
 * El usuario no quiere (o no puede) contestar mas: el mensaje de preguntas se
 * reemplaza por el borrador, armado con la conversacion releida desde su
 * inicio, que viaja en el value del boton.
 */
async function armarConLoQueHay (payload) {
  const responseUrl = payload.response_url
  const estado = parsearEstado(payload.actions?.[0]?.value)
  const canal = payload.channel?.id
  const mensajes = estado && canal ? await leerHistorialDm(canal, { desde: estado.inicio, limite: 50 }) : null
  const turnos = mensajes ? turnosDesde(mensajes, estado.inicio) : []

  if (!turnos.some(t => t.rol === 'usuario' && t.texto)) {
    await reemplazarMensaje(responseUrl, CONVERSACION_PERDIDA)
    return
  }

  try {
    const { titulo } = await interpretarConversacion(turnos, { permitirPreguntas: false })
    await reemplazarMensajeConBloques(responseUrl, bloquesDeBorrador(armarBorrador(turnos, titulo)))
  } catch (err) {
    await reemplazarMensaje(responseUrl, mensajeDeError(err, '[tickets-slack] botón armar'))
  }
}

/** "¿Esto fue suficiente?": cierra el ticket o lo deja seguir con el agente. */
async function responderManual (payload, resuelto) {
  const responseUrl = payload.response_url
  try {
    const texto = await responderManualDesdeSlack({
      ticketId: leerTicketDeManual(payload.actions?.[0]?.value),
      canal: payload.channel?.id,
      resuelto
    })
    await reemplazarMensaje(responseUrl, texto)
  } catch (err) {
    await reemplazarMensaje(responseUrl, mensajeDeError(err, '[tickets-slack] botón manual'))
  }
}
