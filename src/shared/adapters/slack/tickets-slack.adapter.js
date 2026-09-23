// Slack del modulo Tickets. Convive con config/slack.js (el bot de FICO y
// docentes) sin tocarlo: son dos apps distintas de Slack, cada una con sus
// credenciales y su canal.
//
//   SLACK_WEBHOOK_URL     incoming webhook -> el canal de tickets. El canal esta
//                         codificado dentro de la URL, no hace falta variable.
//   SLACK_BOT_TOKEN       Web API: users.info (identidad de quien escribe al
//                         bot), chat.postMessage (seguimiento por DM)
//                         y files.info (imagenes adjuntas).
//   SLACK_SIGNING_SECRET   verificacion de firma de eventos y botones.
//   FRONTEND_PUBLIC_URL    base del ERP (ej. https://app.we-educacion.com) para
//                         armar el link "Ver detalle" del DM de apertura.
//
// Las cuatro son OPCIONALES. Sin webhook no salen notificaciones; sin bot
// token no hay bot por DM ni seguimiento; sin FRONTEND_PUBLIC_URL el DM de apertura sale
// sin el link. Nada de eso rompe el modulo: se sigue trabajando desde la web
// igual que siempre.

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

// Los avisos al canal NO llevan quien reporto ni la problematica: el canal lo
// lee toda el area y ese detalle se ve en el ERP, con el permiso de lectura
// del ticket.
function payloadCreado (t) {
  const emoji = EMOJI_PRIORIDAD[t.priority] ?? ':white_circle:'

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
        { type: 'mrkdwn', text: `*Fecha:*\n${fechaPe(t.registration_date)}` }
      ]
    }
  ]

  const urlDetalle = enlaceAlTicket(t.ticket_id)
  if (urlDetalle) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*🔗 Ver detalle:*\n${urlDetalle}` } })
  }

  // `text` es el fallback de las notificaciones push y de los clientes sin Block Kit.
  return { text: `Ticket #${codigo(t.ticket_id)} creado: ${t.title}`, blocks }
}

// Mensaje PLANO a proposito (solo `text`, sin blocks): es un aviso operativo
// de "andate corriendo a tomarlo", no un resumen para leer con calma. Sale una
// sola vez, apenas se crea el ticket sin asignar.
function payloadEsperandoAsignacion (t, minutos) {
  return {
    text: `⏳ El ticket #${codigo(t.ticket_id)} "${t.title}" está a la espera de asignación. ` +
      `Tiempo: ${minutos} minutos para que algún admin lo tome manualmente antes de que se asigne automáticamente.`
  }
}

function payloadReabierto (t) {
  const emoji = EMOJI_PRIORIDAD[t.priority] ?? ':white_circle:'
  return {
    text: `Ticket #${codigo(t.ticket_id)} reabierto: ${t.title}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `🔓 Ticket #${codigo(t.ticket_id)} reabierto`, emoji: true } },
      { type: 'section', text: { type: 'mrkdwn', text: `*${t.title}*` } },
      { type: 'divider' },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Prioridad:*\n${emoji} ${t.priority}` },
          { type: 'mrkdwn', text: `*A cargo de:*\n${t.asignado ?? 'sin asignar'}` }
        ]
      }
    ]
  }
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
          { type: 'mrkdwn', text: `*Responsable:*\n${t.asignado ?? 'sin asignar'}` }
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
          { type: 'mrkdwn', text: `*Prioridad:*\n${emoji} ${t.priority}` }
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

export function notificarEsperandoAsignacion (ticket, minutos) {
  return enviarWebhook(payloadEsperandoAsignacion(ticket, minutos), `ticket #${ticket.ticket_id} (esperando asignación)`)
}

export function notificarTicketReabierto (ticket) {
  return enviarWebhook(payloadReabierto(ticket), `ticket #${ticket.ticket_id} (reabierto)`)
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
 * Email de quien le escribio al bot. El payload del evento solo trae
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
 * Baja un archivo que alguien adjunto en un DM al bot (scope files:read).
 * files.info da la URL privada, que solo se puede leer con el token del bot.
 * Nunca lanza: null si no se pudo, y quien llama decide si sigue sin el.
 */
export async function descargarArchivoSlack (fileId, maxBytes) {
  if (!slackBotConfigurado() || !fileId) return null
  const auth = { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` }
  try {
    const res = await fetch(`https://slack.com/api/files.info?file=${encodeURIComponent(fileId)}`, {
      headers: auth,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    const datos = await res.json()
    if (!datos.ok) {
      console.error(`[tickets-slack] files.info fallo: ${datos.error}`)
      return null
    }
    const archivo = datos.file ?? {}
    const url = archivo.url_private_download ?? archivo.url_private
    if (!url || (maxBytes && archivo.size > maxBytes)) return null

    const bajada = await fetch(url, { headers: auth, signal: AbortSignal.timeout(TIMEOUT_MS * 3) })
    if (!bajada.ok) {
      console.error(`[tickets-slack] descarga de ${fileId}: HTTP ${bajada.status}`)
      return null
    }
    return {
      buffer: Buffer.from(await bajada.arrayBuffer()),
      nombre: archivo.name ?? archivo.title ?? 'archivo',
      mimeType: archivo.mimetype
    }
  } catch (err) {
    console.error(`[tickets-slack] descarga de ${fileId}: fallo de red`, err.message)
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
 * Reemplaza el mensaje al que le pulsaron un boton, dejandolo sin botones.
 *
 * `blocks: []` va explicito: si solo se manda `text`, Slack conserva los bloques
 * anteriores y los botones seguirian ahi, invitando a pulsarlos de nuevo sobre
 * un borrador que ya se resolvio.
 */
export async function reemplazarMensaje (responseUrl, texto) {
  return enviarResponseUrl(responseUrl, {
    text: texto,
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: texto } }]
  })
}

async function enviarResponseUrl (responseUrl, payload) {
  try {
    const res = await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ replace_original: true, ...payload }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (!res.ok) console.error(`[tickets-slack] response_url: HTTP ${res.status}`)
  } catch (err) {
    console.error('[tickets-slack] response_url: fallo al responder', err.message)
  }
}

// ── Seguimiento por DM ─────────────────────────────────────────────────────
//
// Cuando alguien crea un ticket escribiendole al bot por DM, el bot le confirma
// la apertura y guarda el canal del DM en la fila. A partir de ahi cada avance
// (lo toman, lo comentan, lo resuelven) llega como un mensaje NUEVO en ese
// mismo chat, no como respuesta en un hilo: dentro del hilo las novedades
// quedaban escondidas y habia que abrirlo para enterarse.
//
// Cada aviso nombra el #ticket, asi que con varios tickets abiertos igual se
// sabe de cual es. Los tickets creados desde la web no tienen DM guardado; ahi
// solo llega el cierre (avisarTicketResuelto lo busca por email).

// Mensaje de apertura MINIMO a proposito: quien lo escribe ya sabe que conto,
// y el detalle completo vive en el ERP; repetir la problematica aca era el bug
// que hacia parecer que "se seguia mandando por DM".
export function construirMensajeDeApertura (ticket) {
  const emoji = EMOJI_PRIORIDAD[ticket.priority] ?? ':white_circle:'
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `🆕 Ticket #${codigo(ticket.ticket_id)} creado`, emoji: true } },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Prioridad:*\n${emoji} ${ticket.priority}` },
        { type: 'mrkdwn', text: `*Asignado a:*\n${ticket.asignado ?? 'sin asignar'}` }
      ]
    }
  ]

  const urlDetalle = enlaceAlTicket(ticket.ticket_id)
  if (urlDetalle) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*🔗 Ver detalle:*\n${urlDetalle}` } })
  }

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: 'Te voy avisando por acá cómo avanza.' }]
  })

  return { text: `Ticket #${codigo(ticket.ticket_id)} creado`, blocks }
}

/** Link al detalle en el ERP. Sin FRONTEND_PUBLIC_URL configurado, se omite el bloque. */
function enlaceAlTicket (ticketId) {
  const base = process.env.FRONTEND_PUBLIC_URL
  if (!base) return null
  return `${base.replace(/\/+$/, '')}/tickets/${ticketId}`
}

/**
 * Confirma la apertura por DM y devuelve { canal, ts } de ese mensaje (el
 * canal D... es lo que se guarda para seguir escribiendo), o null.
 */
export function abrirHiloDeTicket (ticket, slackUserId) {
  return postearMensaje(slackUserId, construirMensajeDeApertura(ticket))
}

/**
 * Publica una novedad como mensaje nuevo en el DM del ticket (sin thread_ts).
 * Sin DM guardado, no hace nada.
 */
export async function avisarEnDm (ticket, texto, blocks) {
  if (!ticket?.slack_channel_id) return null
  return postearMensaje(ticket.slack_channel_id, { text: texto, blocks })
}

/**
 * El user_id de Slack de una cuenta del ERP, cruzando por email (el ERP no
 * guarda el mapeo). Scope users:read.email. Nunca lanza: null si no hay match.
 */
export async function buscarUsuarioSlackPorEmail (email) {
  if (!slackBotConfigurado() || !email) return null
  try {
    const res = await fetch(`https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    const datos = await res.json()
    if (!datos.ok) {
      console.error(`[tickets-slack] users.lookupByEmail fallo: ${datos.error}`)
      return null
    }
    return datos.user?.id ?? null
  } catch (err) {
    console.error('[tickets-slack] users.lookupByEmail: fallo de red', err.message)
    return null
  }
}

/**
 * Mensaje directo a quien reporto. Va al DM del ticket si nacio en Slack; si
 * nacio en la web no hay DM guardado, asi que se le escribe buscandolo por su
 * email. Devuelve si llego.
 */
async function avisarAlSolicitante (ticket, texto, blocks) {
  if (ticket.slack_channel_id) {
    return Boolean(await avisarEnDm(ticket, texto, blocks))
  }
  const slackUserId = await buscarUsuarioSlackPorEmail(ticket.creador_email)
  if (!slackUserId) return false
  return Boolean(await postearMensaje(slackUserId, { text: texto, blocks }))
}

/** Primera senal de vida que espera el solicitante: alguien tomo el ticket. */
export function avisarTicketTomado (ticket, agente) {
  const texto = `👀 Tu ticket #${codigo(ticket.ticket_id)} "${ticket.title}" está siendo revisado por *${agente}*.`
  return avisarAlSolicitante(ticket, texto, [{ type: 'section', text: { type: 'mrkdwn', text: texto } }])
}

/**
 * El ticket cambio de dueño (a mano, por el reparto automatico o por SLA).
 * `primeraAsignacion` distingue "asignado" de "reasignado": un ticket sin dueño
 * no se reasigna.
 */
export function avisarTicketReasignado (ticket, agente, { primeraAsignacion = false } = {}) {
  const accion = primeraAsignacion ? 'fue asignado a' : 'fue reasignado a'
  const texto = `🔄 Tu ticket #${codigo(ticket.ticket_id)} "${ticket.title}" ${accion} *${agente}*, quien lo revisará.`
  return avisarAlSolicitante(ticket, texto, [{ type: 'section', text: { type: 'mrkdwn', text: texto } }])
}

/** Confirmacion de cierre para quien reporto. Devuelve si llego. */
export async function avisarTicketResuelto (ticket, agente) {
  const texto = `✅ Tu ticket #${codigo(ticket.ticket_id)} "${ticket.title}" fue resuelto por *${agente}*.`
  const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: texto } }]
  const urlDetalle = enlaceAlTicket(ticket.ticket_id)
  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `Si el problema sigue, abre nuevamente el ticket desde el sistema ERP${urlDetalle ? `: ${urlDetalle}` : '.'}`
    }]
  })

  return avisarAlSolicitante(ticket, texto, blocks)
}

/** Replica en el DM lo que escribieron en el ticket. */
export function avisarComentarioNuevo (ticket, autor, cuerpo) {
  const encabezado = `💬 *${autor}* comentó en tu ticket #${codigo(ticket.ticket_id)}:`
  return avisarEnDm(ticket, `${encabezado} ${cuerpo}`, [
    { type: 'section', text: { type: 'mrkdwn', text: encabezado } },
    { type: 'section', text: { type: 'mrkdwn', text: `>${truncar(cuerpo).replace(/\n/g, '\n>')}` } }
  ])
}
