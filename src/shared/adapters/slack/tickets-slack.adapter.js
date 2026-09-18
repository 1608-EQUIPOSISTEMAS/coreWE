// Slack del modulo Tickets. Convive con config/slack.js (el bot de FICO y
// docentes) sin tocarlo: son dos apps distintas de Slack, cada una con sus
// credenciales y su canal.
//
//   SLACK_WEBHOOK_URL     incoming webhook -> el canal de tickets. El canal esta
//                         codificado dentro de la URL, no hace falta variable.
//   SLACK_BOT_TOKEN       Web API: users.info (identidad del slash command) y
//                         chat.postMessage (hilo de seguimiento por DM).
//   SLACK_SIGNING_SECRET   verificacion de firma del slash command.
//
// Las tres son OPCIONALES. Sin webhook no salen notificaciones; sin bot token
// no hay /ticket ni hilo. Nada de eso rompe el modulo: se sigue trabajando
// desde la web igual que siempre.

const TIMEOUT_MS = 5000

// Limite de Slack para un bloque section (3000); se deja margen para no
// arriesgar un rechazo por payload invalido.
const LIMITE_TEXTO_BLOQUE = 2900

const EMOJI_PRIORIDAD = {
  ALTA: ':red_circle:',
  MEDIA: ':large_yellow_circle:',
  BAJA: ':large_green_circle:'
}

const ETIQUETA_RELOJ = { respuesta: 'primera respuesta', resolucion: 'resolución' }

const truncar = (texto, limite = LIMITE_TEXTO_BLOQUE) =>
  (texto.length > limite ? `${texto.slice(0, limite - 1)}…` : texto)

const codigo = n => String(n ?? '').padStart(5, '0')
const fechaPe = d => new Date(d).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' })

export const slackWebhookConfigurado = () => Boolean(process.env.SLACK_WEBHOOK_URL)
export const slackBotConfigurado = () => Boolean(process.env.SLACK_BOT_TOKEN)

let yaAvisoSinWebhook = false

/**
 * Envio comun por webhook. Nunca lanza, pero DEVUELVE si el mensaje llego:
 * quien llama decide que hacer con el fallo. La creacion de un ticket lo
 * ignora; el barrido del SLA lo usa para reintentar en la proxima corrida en
 * vez de dar por enviado un aviso que nadie vio.
 */
async function enviarWebhook (payload, referencia) {
  const url = process.env.SLACK_WEBHOOK_URL
  if (!url) {
    if (!yaAvisoSinWebhook) {
      console.warn('[tickets-slack] SLACK_WEBHOOK_URL sin configurar: notificaciones desactivadas')
      yaAvisoSinWebhook = true
    }
    return false
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (!res.ok) {
      const detalle = await res.text().catch(() => '')
      console.error(`[tickets-slack] ${referencia}: HTTP ${res.status} ${detalle}`.trim())
      return false
    }
    return true
  } catch (err) {
    console.error(`[tickets-slack] ${referencia}: fallo al notificar`, err.message)
    return false
  }
}

// ── Payloads ───────────────────────────────────────────────────────────────

function payloadCreado (t) {
  const emoji = EMOJI_PRIORIDAD[t.priority] ?? ':white_circle:'
  const problema = String(t.problem ?? '').trim()

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `🆕 Ticket #${codigo(t.ticket_id)} creado`, emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: `*${t.title}*` } },
    { type: 'divider' },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Prioridad:*\n${emoji} ${t.priority}` },
        { type: 'mrkdwn', text: `*Área:*\n${t.area ?? 'Sin área'}` },
        { type: 'mrkdwn', text: `*Asignado a:*\n${t.asignado ?? 'sin asignar'}` },
        { type: 'mrkdwn', text: `*Reportado por:*\n${t.creador ?? 'desconocido'}` },
        { type: 'mrkdwn', text: `*Fecha:*\n${fechaPe(t.registration_date)}` }
      ]
    }
  ]

  if (problema) {
    blocks.push({ type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: `*📝 Problemática:*\n${truncar(problema)}` } })
  }
  if (t.link) {
    blocks.push({ type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: `*🔗 Referencia:*\n${t.link}` } })
  }

  // `text` es el fallback de las notificaciones push y de los clientes sin Block Kit.
  return { text: `Ticket #${codigo(t.ticket_id)} creado: ${t.title}`, blocks }
}

function payloadCerrado (t) {
  const emoji = EMOJI_PRIORIDAD[t.priority] ?? ':white_circle:'
  return {
    text: `Ticket #${codigo(t.ticket_id)} cerrado: ${t.title}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `✅ Ticket #${codigo(t.ticket_id)} resuelto`, emoji: true } },
      { type: 'section', text: { type: 'mrkdwn', text: `*${t.title}*` } },
      { type: 'divider' },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Prioridad:*\n${emoji} ${t.priority}` },
          { type: 'mrkdwn', text: `*Resuelto por:*\n${t.asignado ?? 'sin asignar'}` },
          { type: 'mrkdwn', text: `*Reportado por:*\n${t.creador ?? 'desconocido'}` },
          { type: 'mrkdwn', text: `*Fecha de cierre:*\n${fechaPe(t.resolved_at ?? Date.now())}` }
        ]
      }
    ]
  }
}

function payloadSla (t, reloj, venceEn) {
  const emoji = EMOJI_PRIORIDAD[t.priority] ?? ':white_circle:'
  return {
    text: `Plazo vencido — ticket #${codigo(t.ticket_id)}: ${t.title}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `⚠️ Plazo vencido — ticket #${codigo(t.ticket_id)}`, emoji: true } },
      { type: 'section', text: { type: 'mrkdwn', text: `*${t.title}*` } },
      { type: 'divider' },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Plazo vencido:*\n${ETIQUETA_RELOJ[reloj]}` },
          { type: 'mrkdwn', text: `*Venció el:*\n${fechaPe(venceEn)}` },
          { type: 'mrkdwn', text: `*Prioridad:*\n${emoji} ${t.priority}` },
          { type: 'mrkdwn', text: `*Responsable:*\n${t.asignado ?? 'sin asignar'}` },
          { type: 'mrkdwn', text: `*Reportado por:*\n${t.creador ?? 'desconocido'}` }
        ]
      }
    ]
  }
}

function payloadEscalado (t, agenteAnterior, motivo) {
  const emoji = EMOJI_PRIORIDAD[t.priority] ?? ':white_circle:'
  return {
    text: `Ticket #${codigo(t.ticket_id)} reasignado a ${t.asignado ?? 'sin asignar'}: ${motivo}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `🔄 Ticket #${codigo(t.ticket_id)} reasignado`, emoji: true } },
      { type: 'section', text: { type: 'mrkdwn', text: `*${t.title}*` } },
      { type: 'divider' },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Asignado a:*\n${t.asignado ?? 'sin asignar'}` },
          { type: 'mrkdwn', text: `*Antes lo tenía:*\n${agenteAnterior}` },
          { type: 'mrkdwn', text: `*Motivo:*\n${motivo}` },
          { type: 'mrkdwn', text: `*Prioridad:*\n${emoji} ${t.priority}` },
          { type: 'mrkdwn', text: `*Reportado por:*\n${t.creador ?? 'desconocido'}` }
        ]
      }
    ]
  }
}

// ── Notificaciones al canal ────────────────────────────────────────────────

export function notificarTicketCreado (ticket) {
  return enviarWebhook(payloadCreado(ticket), `ticket #${ticket.ticket_id} (creado)`)
}

export function notificarTicketCerrado (ticket) {
  return enviarWebhook(payloadCerrado(ticket), `ticket #${ticket.ticket_id} (cerrado)`)
}

export function notificarSlaIncumplido (ticket, reloj, venceEn) {
  return enviarWebhook(payloadSla(ticket, reloj, venceEn), `sla ${reloj} #${ticket.ticket_id}`)
}

// Se avisa por nombre y no con @mencion: el ERP no guarda un mapeo
// usuario -> ID de Slack, solo el email.
export function notificarTicketEscalado (ticket, agenteAnterior, motivo) {
  return enviarWebhook(payloadEscalado(ticket, agenteAnterior, motivo), `escalamiento #${ticket.ticket_id}`)
}

// ── Web API ────────────────────────────────────────────────────────────────

/**
 * Email de quien ejecuto el slash command. El payload del comando solo trae
 * user_id (y user_name, que es el username de Slack, no el email), asi que hay
 * que pedirselo a la Web API con el scope users:read.email.
 */
export async function obtenerEmailDeUsuarioSlack (slackUserId) {
  if (!slackBotConfigurado()) return null
  try {
    const res = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(slackUserId)}`, {
      headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    const datos = await res.json()
    if (!datos.ok) {
      console.error(`[tickets-slack] users.info fallo: ${datos.error}`)
      return null
    }
    return datos.user?.profile?.email ?? null
  } catch (err) {
    console.error('[tickets-slack] users.info: fallo de red', err.message)
    return null
  }
}

/**
 * Postea con el bot. `destino` puede ser un ID de usuario (U...), en cuyo caso
 * Slack abre el DM solo y devuelve el canal D... real, que es el que hay que
 * guardar para seguir escribiendo en el mismo chat.
 *
 * Con `hilo` la publicacion va como respuesta de ese mensaje. Nunca lanza:
 * devuelve null si no se pudo postear.
 */
export async function postearMensaje (destino, payload, hilo = null) {
  if (!slackBotConfigurado()) return null
  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify({
        channel: hilo?.canal ?? destino,
        ...payload,
        ...(hilo ? { thread_ts: hilo.ts } : {})
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    const datos = await res.json()
    if (!datos.ok || !datos.channel || !datos.ts) {
      console.error(`[tickets-slack] chat.postMessage fallo: ${datos.error ?? 'respuesta incompleta'}`)
      return null
    }
    return { canal: datos.channel, ts: datos.ts }
  } catch (err) {
    console.error('[tickets-slack] chat.postMessage: fallo de red', err.message)
    return null
  }
}

/**
 * El slash command ya recibio su ACK dentro de los 3 s que exige Slack; el
 * resultado real se entrega despues posteando a esta URL de un solo uso que
 * Slack manda en cada invocacion.
 */
export async function responderResponseUrl (responseUrl, texto) {
  try {
    const res = await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response_type: 'ephemeral', replace_original: true, text: texto }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (!res.ok) console.error(`[tickets-slack] response_url: HTTP ${res.status}`)
  } catch (err) {
    console.error('[tickets-slack] response_url: fallo al responder', err.message)
  }
}

// ── Hilo de seguimiento por DM ─────────────────────────────────────────────
//
// Cuando alguien crea un ticket con /ticket, el bot le manda un DM con el
// detalle y guarda ese mensaje en la fila. A partir de ahi cada avance (lo
// toman, lo comentan, lo resuelven) se cuelga como respuesta del mismo mensaje:
// el solicitante ve todo el recorrido en un hilo, sin entrar a la web.
//
// Los tickets creados desde la web no tienen hilo y aca no pasa nada.

export function construirMensajeDeApertura (ticket) {
  const emoji = EMOJI_PRIORIDAD[ticket.priority] ?? ':white_circle:'
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `🆕 Ticket #${codigo(ticket.ticket_id)} creado`, emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: `*${ticket.title}*` } },
    { type: 'divider' },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Prioridad:*\n${emoji} ${ticket.priority}` },
        { type: 'mrkdwn', text: `*Asignado a:*\n${ticket.asignado ?? 'sin asignar'}` }
      ]
    },
    { type: 'section', text: { type: 'mrkdwn', text: `*📝 Problemática:*\n${truncar(String(ticket.problem ?? ''))}` } }
  ]

  if (ticket.link) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*🔗 Referencia:*\n${ticket.link}` } })
  }

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: 'Te voy avisando por acá cómo avanza: cada novedad queda en el hilo de este mensaje.' }]
  })

  return { text: `Ticket #${codigo(ticket.ticket_id)} creado: ${ticket.title}`, blocks }
}

/** Abre el DM y devuelve el mensaje raiz, o null si no se pudo. */
export function abrirHiloDeTicket (ticket, slackUserId) {
  return postearMensaje(slackUserId, construirMensajeDeApertura(ticket))
}

/** Publica una novedad en el hilo. Sin hilo guardado, no hace nada. */
export async function avisarEnHilo (ticket, texto, blocks) {
  if (!ticket?.slack_channel_id || !ticket?.slack_message_ts) return
  await postearMensaje(ticket.slack_channel_id, { text: texto, blocks },
    { canal: ticket.slack_channel_id, ts: ticket.slack_message_ts })
}

/** Primera senal de vida que espera el solicitante: alguien tomo el ticket. */
export function avisarTicketTomado (ticket, agente) {
  const texto = `👀 *${agente}* está trabajando en tu ticket #${codigo(ticket.ticket_id)}.`
  return avisarEnHilo(ticket, texto, [{ type: 'section', text: { type: 'mrkdwn', text: texto } }])
}

export function avisarTicketResuelto (ticket, agente) {
  const texto = `✅ Tu ticket #${codigo(ticket.ticket_id)} fue resuelto por *${agente}*.`
  return avisarEnHilo(ticket, texto, [
    { type: 'section', text: { type: 'mrkdwn', text: texto } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: 'Si el problema sigue, crea un ticket nuevo con `/ticket`.' }] }
  ])
}

/** Replica en el hilo lo que escribieron en el ticket. */
export function avisarComentarioNuevo (ticket, autor, cuerpo) {
  const encabezado = `💬 *${autor}* comentó en tu ticket #${codigo(ticket.ticket_id)}:`
  return avisarEnHilo(ticket, `${encabezado} ${cuerpo}`, [
    { type: 'section', text: { type: 'mrkdwn', text: encabezado } },
    { type: 'section', text: { type: 'mrkdwn', text: `>${truncar(cuerpo).replace(/\n/g, '\n>')}` } }
  ])
}
