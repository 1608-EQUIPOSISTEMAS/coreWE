import { responderManualDesdeSlack } from '../tickets.usecases.js'
import { reemplazarMensaje } from '../../../shared/adapters/slack/tickets-slack.adapter.js'
import { ACCION_MANUAL_SI, ACCION_MANUAL_NO, leerTicketDeManual } from './slack.blocks.js'
import { yaProcesado, mensajeDeError } from './slack.events.js'

// El unico boton que queda: el "Si / No" del manual que se ofrece como
// posible solucion de un ticket. Crear el ticket ya no pasa por botones — se
// crea solo cuando el contexto alcanza, ver slack.events.js. Slack manda estas
// interacciones como x-www-form-urlencoded con un unico campo `payload` que
// trae el JSON (parser de slack.verify.js), y la firma se verifica igual que
// en los eventos.
//
// En la consola de Slack se configura en "Interactivity & Shortcuts" apuntando
// a esta ruta.

const ACCIONES = [ACCION_MANUAL_SI, ACCION_MANUAL_NO]

export function interactionsHandler (req, reply) {
  // Slack corta a los 3 s igual que en los eventos.
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

  // Doble clic sobre el mismo mensaje: el ts del mensaje lo identifica.
  if (yaProcesado(`${accion}:${payload.message?.ts}`)) return

  void responderManual(accion, payload)
}

/** "¿Esto fue suficiente?": cierra el ticket o lo deja seguir con el agente. */
async function responderManual (accion, payload) {
  const responseUrl = payload.response_url
  if (!responseUrl) return

  try {
    const texto = await responderManualDesdeSlack({
      ticketId: leerTicketDeManual(payload.actions?.[0]?.value),
      canal: payload.channel?.id,
      resuelto: accion === ACCION_MANUAL_SI
    })
    await reemplazarMensaje(responseUrl, texto)
  } catch (err) {
    await reemplazarMensaje(responseUrl, mensajeDeError(err, '[tickets-slack] botón manual'))
  }
}
