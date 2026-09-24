import { createTicketFromSlack } from '../tickets.usecases.js'
import { formatTicketCode } from '../tickets.entity.js'
import { reemplazarMensaje } from '../../../shared/adapters/slack/tickets-slack.adapter.js'
import { ACCION_CREAR, ACCION_DESCARTAR, leerBorrador } from './slack.blocks.js'
import { yaProcesado, mensajeDeError } from './slack.events.js'

// Los dos botones del borrador. Slack manda estas interacciones como
// x-www-form-urlencoded con un unico campo `payload` que trae el JSON (parser de
// slack.verify.js), y la firma se verifica igual que en los eventos.
//
// En la consola de Slack se configura en "Interactivity & Shortcuts" apuntando
// a esta ruta.

const DESCARTADO = '🗑️ Listo, no creé nada. Si lo necesitas más adelante, vuelve a escribirme.'
const BORRADOR_VIEJO =
  '⚠️ No pude recuperar este borrador (probablemente es de antes del último despliegue).\n' +
  'Vuelve a escribirme el problema y te armo uno nuevo.'

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
  if (accion !== ACCION_CREAR && accion !== ACCION_DESCARTAR) return

  // Doble clic sobre el mismo borrador: el ts del mensaje lo identifica. Sin
  // esto, dos toques seguidos al boton crean dos tickets iguales.
  if (yaProcesado(`accion:${payload.message?.ts}`)) return

  void resolver(accion, payload)
}

async function resolver (accion, payload) {
  const responseUrl = payload.response_url
  if (!responseUrl) return

  if (accion === ACCION_DESCARTAR) {
    await reemplazarMensaje(responseUrl, DESCARTADO)
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
