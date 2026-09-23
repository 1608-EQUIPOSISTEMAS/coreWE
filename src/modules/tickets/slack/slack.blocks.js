import { escaparSlack, desescaparSlack } from './slack.text.js'

// Bloques del borrador que el bot propone por DM, y su lectura inversa.
//
// El borrador NO se guarda en ninguna parte: vive en el propio mensaje de
// Slack. Cuando alguien pulsa un boton, Slack devuelve el mensaje completo en
// el payload de interactividad, asi que el titulo y la problematica se leen de
// vuelta de sus bloques por block_id.
//
// Es a proposito: un Map en memoria se pierde en cada deploy (y no lo ve la
// otra replica), y una tabla de borradores seria una tabla nueva, con su
// limpieza y su DDL, para un dato que caduca en dos minutos.

export const ACCION_CREAR = 'ticket_crear'
export const ACCION_DESCARTAR = 'ticket_descartar'

const BLOQUE_TITULO = 'tk_titulo'
const BLOQUE_PROBLEMA = 'tk_problema'
const BLOQUE_ENLACE = 'tk_enlace'

// Los section aceptan hasta 3 000 caracteres y la problematica llega acotada a
// 2 000 por la entity, pero el corte se queda por si algun dia ese tope sube.
const SECTION_MAX = 2900

const campo = (etiqueta, valor) => `*${etiqueta}:*\n${escaparSlack(valor)}`

/** Lee el valor de un `campo()`: todo lo que sigue al primer salto de linea. */
function leerCampo (bloques, blockId) {
  const texto = bloques?.find(b => b.block_id === blockId)?.text?.text
  if (typeof texto !== 'string') return null
  const salto = texto.indexOf('\n')
  return salto === -1 ? null : desescaparSlack(texto.slice(salto + 1)).trim()
}

/**
 * El borrador con sus dos botones.
 *
 * @param {{ titulo: string, problema: string, enlaces: string[] }} borrador
 */
export function bloquesDeBorrador ({ titulo, problema, enlaces = [] }) {
  const bloques = [
    { type: 'section', text: { type: 'mrkdwn', text: '📝 Esto es lo que entendí. ¿Lo creo como ticket?' } },
    { type: 'section', block_id: BLOQUE_TITULO, text: { type: 'mrkdwn', text: campo('Título', titulo) } },
    {
      type: 'section',
      block_id: BLOQUE_PROBLEMA,
      text: { type: 'mrkdwn', text: campo('Problemática', problema).slice(0, SECTION_MAX) }
    }
  ]

  // Solo el primero: `link` en la fila es una columna, no una lista. Los demas
  // siguen estando dentro de la problematica, que es el texto original.
  if (enlaces.length) {
    bloques.push({
      type: 'section',
      block_id: BLOQUE_ENLACE,
      text: { type: 'mrkdwn', text: campo('Enlace', enlaces[0]) }
    })
  }

  bloques.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        action_id: ACCION_CREAR,
        style: 'primary',
        text: { type: 'plain_text', text: 'Crear ticket', emoji: true },
        value: 'crear'
      },
      {
        type: 'button',
        action_id: ACCION_DESCARTAR,
        text: { type: 'plain_text', text: 'Descartar', emoji: true },
        value: 'descartar'
      }
    ]
  })

  bloques.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: 'Si el título no te convence, lo puedes corregir después desde el ERP.' }]
  })

  return { text: `¿Creo un ticket con "${titulo}"?`, blocks: bloques }
}

/**
 * Recupera el borrador de los bloques del mensaje al que le pulsaron un boton.
 * Devuelve null si el mensaje no tiene la forma esperada (por ejemplo, un
 * mensaje viejo de una version anterior de estos bloques).
 */
export function leerBorrador (bloques) {
  const titulo = leerCampo(bloques, BLOQUE_TITULO)
  const problema = leerCampo(bloques, BLOQUE_PROBLEMA)
  if (!titulo || !problema) return null
  return { titulo, problema, link: leerCampo(bloques, BLOQUE_ENLACE) }
}

/** Reemplazo del borrador una vez resuelto: el mismo mensaje, ya sin botones. */
export function bloquesDeTextoPlano (texto) {
  return { text: texto, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: texto } }] }
}
