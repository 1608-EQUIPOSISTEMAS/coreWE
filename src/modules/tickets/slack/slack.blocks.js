import { escaparSlack, desescaparSlack, limpiarTextoSlack } from './slack.text.js'

// Bloques de los mensajes que el bot postea por DM, y su lectura inversa.
//
// El ticket ya no se confirma con botones: se crea solo cuando el contexto
// alcanza (slack.events.js decide cuando). Lo que queda con botones es el
// manual que se ofrece como posible solucion (Si/No), y el estado de la
// entrevista (preguntas) que viaja en el propio mensaje, sin guardarse en
// ninguna parte: un Map en memoria se pierde en cada deploy (y no lo ve la
// otra replica), y una tabla para esto seria mas maquinaria que problema, para
// un dato que caduca en minutos.

export const ACCION_MANUAL_SI = 'ticket_manual_si'
export const ACCION_MANUAL_NO = 'ticket_manual_no'

export const BLOQUE_PREGUNTAS = 'tk_preguntas'

// Mismo tope que la web (tickets.files.js MAX_FILES).
export const MAX_ARCHIVOS = 4

// Los section aceptan hasta 3 000 caracteres y la problematica llega acotada a
// 2 000 por la entity, pero el corte se queda por si algun dia ese tope sube.
const SECTION_MAX = 2900

// El ticket ya no se confirma con un boton: se crea solo cuando el contexto
// alcanza (ver slack.events.js). El estado de la entrevista (ronda, inicio)
// no tiene boton donde viajar, asi que se codifica en el block_id de un bloque
// que de todos modos iba a estar ahi; Slack lo devuelve tal cual junto con el
// resto del mensaje, y de eso se relee sin guardar nada en ninguna parte.
const BLOQUE_ESTADO = 'tk_estado'

/**
 * El estado { ronda, inicio } de un mensaje de preguntas, o null si no tiene
 * esa forma (por ejemplo, un mensaje de antes del ultimo despliegue).
 */
export function leerEstadoDeMensaje (mensaje) {
  const bloque = mensaje?.blocks?.find(b => typeof b.block_id === 'string' && b.block_id.startsWith(`${BLOQUE_ESTADO}:`))
  if (!bloque) return null
  try {
    const { ronda, inicio } = JSON.parse(bloque.block_id.slice(BLOQUE_ESTADO.length + 1))
    return Number.isInteger(ronda) && ronda >= 1 && typeof inicio === 'string' ? { ronda, inicio } : null
  } catch {
    return null
  }
}

/** Las preguntas de un mensaje de preguntas, leidas de vuelta de su texto. */
export function leerPreguntasDeMensaje (mensaje) {
  const texto = mensaje?.blocks?.find(b => b.block_id === BLOQUE_PREGUNTAS)?.text?.text
  if (typeof texto !== 'string') return []
  return texto.split('\n')
    .map(l => desescaparSlack(l.replace(/^\d+\.\s*/, '')).trim())
    .filter(Boolean)
}

/**
 * Las preguntas de una ronda de la entrevista (ver slack.conversacion.js).
 *
 * Sin botones: si quedan preguntas, el usuario las contesta escribiendo por
 * el DM, y si ya no quiere seguir contestando, igual puede escribir "no sé" o
 * lo que tenga — el bot sigue con eso (ver MAX_RONDAS en slack.conversacion.js).
 *
 * @param {{ preguntas: string[], ronda: number, inicio: string }} entrevista
 */
export function bloquesDePreguntas ({ preguntas, ronda, inicio }) {
  const lista = preguntas.map((p, i) => `${i + 1}. ${escaparSlack(p)}`).join('\n')
  const intro = ronda === 1
    ? '🧐 Antes de armar el ticket necesito un par de datos para que lo resuelvan más rápido:'
    : '🙏 Gracias. Una última cosa:'

  return {
    text: `${intro}\n${preguntas.join('\n')}`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: intro } },
      { type: 'section', block_id: BLOQUE_PREGUNTAS, text: { type: 'mrkdwn', text: lista.slice(0, SECTION_MAX) } },
      {
        type: 'context',
        block_id: `${BLOQUE_ESTADO}:${JSON.stringify({ ronda, inicio })}`,
        elements: [{ type: 'mrkdwn', text: 'Respóndeme por acá, en uno o varios mensajes. Si no sabes algún dato, dímelo y seguimos.' }]
      }
    ]
  }
}

/**
 * El manual que podria resolver el ticket, con la pregunta y su plazo (ver
 * manual/). Un PDF ya se subio al DM justo antes; un enlace va aca mismo.
 *
 * @param {{ codigo: string, documento: { title: string, kind: string, url?: string },
 *           minutos: number, ticketId: number }} manual
 */
export function bloquesDeManual ({ codigo, documento, minutos, ticketId }) {
  const donde = documento.kind === 'ENLACE' && documento.url
    ? `<${documento.url}|${escaparSlack(documento.title)}>`
    : `*${escaparSlack(documento.title)}* (te lo dejé arriba en PDF)`
  const value = JSON.stringify({ ticket: ticketId })

  return {
    text: `📘 Encontré un manual que podría resolver tu ticket #${codigo}. ¿Esto fue suficiente para la solución?`,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `📘 Encontré un manual que podría resolver tu ticket *#${codigo}*:\n${donde}` }
      },
      { type: 'section', text: { type: 'mrkdwn', text: '*¿Esto fue suficiente para la solución?*' } },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            action_id: ACCION_MANUAL_SI,
            style: 'primary',
            text: { type: 'plain_text', text: 'Sí, quedó resuelto', emoji: true },
            value
          },
          {
            type: 'button',
            action_id: ACCION_MANUAL_NO,
            text: { type: 'plain_text', text: 'No, sigo necesitando ayuda', emoji: true },
            value
          }
        ]
      },
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `⏱️ Tienes *${minutos} minutos* para responder. Si no respondes, daré el ticket por resuelto automáticamente.`
        }]
      }
    ]
  }
}

/** El ticket del value de los botones del manual, o null. */
export function leerTicketDeManual (value) {
  try {
    const { ticket } = JSON.parse(value ?? '')
    return Number.isInteger(ticket) && ticket > 0 ? ticket : null
  } catch {
    return null
  }
}

/** Reemplazo del borrador una vez resuelto: el mismo mensaje, ya sin botones. */
export function bloquesDeTextoPlano (texto) {
  return { text: texto, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: texto } }] }
}
