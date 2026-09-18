import { createTicketFromSlack } from '../tickets.usecases.js'
import { responderResponseUrl } from '../../../shared/adapters/slack/tickets-slack.adapter.js'
import { formatTicketCode } from '../tickets.entity.js'

// Slash command /ticket.
//
// Formato: `/ticket Título | Problemática | link opcional`
//
// Slack exige el ACK en menos de 3 segundos y crear el ticket encadena varias
// llamadas a su API (resolver el email, insertar, abrir el DM) que pueden
// tardar mas. Por eso se responde de inmediato y el resultado real se entrega
// despues por la response_url, que es de un solo uso y caduca a los 30 minutos.

const AYUDA = 'Formato: `/ticket Título | Descripción del problema | link opcional`'

export function parsearComando (texto = '') {
  const [titulo, problema, link] = String(texto).split('|').map(p => p.trim())
  return { titulo, problema, link: link || null }
}

export function slashCommandHandler (req, reply) {
  const body = req.body ?? {}

  // ACK inmediato. El efimero se reemplaza luego con el resultado.
  reply.code(200).send({ response_type: 'ephemeral', text: '⏳ Creando tu ticket…' })

  void procesar(body)
}

async function procesar (body) {
  const responseUrl = body.response_url
  if (!responseUrl) return

  const { titulo, problema, link } = parsearComando(body.text)
  if (!titulo || !problema) {
    await responderResponseUrl(responseUrl, `❌ Falta el título o la descripción.\n${AYUDA}`)
    return
  }

  try {
    const ticket = await createTicketFromSlack({ slackUserId: body.user_id, titulo, problema, link })
    await responderResponseUrl(responseUrl,
      `✅ Ticket #${formatTicketCode(ticket.ticket_id)} creado con prioridad *${ticket.priority}*. Te sigo contando por DM cómo avanza.`)
  } catch (err) {
    // DomainError trae un mensaje escrito para leerse; cualquier otra cosa se
    // enmascara, que para eso esta el log.
    const mensaje = err?.expose ? err.message : 'Ocurrió un error al crear el ticket'
    if (!err?.expose) console.error('[tickets-slack] /ticket:', err)
    await responderResponseUrl(responseUrl, `❌ ${mensaje}`)
  }
}
