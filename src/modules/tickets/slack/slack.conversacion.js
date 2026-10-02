import { limpiarTextoSlack, recortar } from './slack.text.js'
import { ACCION_OMITIR, BLOQUE_PREGUNTAS, MAX_ARCHIVOS } from './slack.blocks.js'
import { MIME_PERMITIDOS, MAX_BYTES } from '../tickets.files.js'

// La entrevista previa al borrador: reglas puras, sin Slack ni IA.
//
// Un primer DM casi nunca trae todo lo que soporte necesita (donde paso, sobre
// que alumno o venta, desde cuando). En vez de crear el ticket con lo que haya
// y que el agente pregunte despues por el ERP, el bot hace hasta MAX_RONDAS
// rondas de preguntas antes de proponer el borrador.
//
// El estado de la entrevista NO se guarda en ninguna parte, igual que el
// borrador: se reconstruye del historial del DM (conversations.history). Cada
// mensaje de preguntas lleva en el value de su boton { ronda, inicio,
// preguntas }, que Slack devuelve tal cual; `inicio` es el ts del primer
// mensaje del usuario, el ancla desde donde se relee la conversacion.

export const MAX_RONDAS = 2

// Una entrevista que el usuario dejo colgada media hora ya no es la misma
// conversacion: lo que escriba despues arranca de cero.
export const VENTANA_ENTREVISTA_S = 30 * 60

// Mensajes sueltos que el usuario mando seguidos antes de que el bot contestara
// ("hola" + el problema, o el problema partido en dos) se leen juntos.
export const VENTANA_PENDIENTES_S = 10 * 60

// Tope de la columna problem en la entity. Se recorta aca para que el borrador
// muestre exactamente lo que se va a guardar, y no prometa un texto que la
// validacion despues rechazaria entero.
export const PROBLEMA_MAX = 2000
export const PROBLEMA_MIN = 10

/** Los adjuntos de un mensaje que el ticket acepta (mismos tipos y peso que la web). */
export function archivosDelMensaje (mensaje) {
  return (mensaje?.files ?? [])
    .filter(f => f?.id && MIME_PERMITIDOS.includes(f.mimetype) && (!f.size || f.size <= MAX_BYTES))
    .slice(0, MAX_ARCHIVOS)
    .map(f => ({ id: f.id, nombre: f.name ?? f.title ?? 'archivo' }))
}

const esDelBot = m => Boolean(m?.bot_id)

// Mismo criterio que esDmDePersona: lo que no es un mensaje "normal" de la
// persona (ediciones, borrados, hilos) no es parte de la conversacion.
const esDeLaPersona = m => !esDelBot(m) && m?.user &&
  (!m.subtype || m.subtype === 'file_share') &&
  (!m.thread_ts || m.thread_ts === m.ts)

/** El estado guardado en el boton de un mensaje de preguntas, o null. */
export function leerEstadoDePreguntas (mensaje) {
  if (!mensaje?.blocks?.some(b => b.block_id === BLOQUE_PREGUNTAS)) return null
  const boton = mensaje.blocks.find(b => b.type === 'actions')?.elements?.find(e => e.action_id === ACCION_OMITIR)
  return parsearEstado(boton?.value)
}

export function parsearEstado (value) {
  try {
    const { ronda, inicio, preguntas } = JSON.parse(value ?? '')
    if (!Number.isInteger(ronda) || ronda < 1 || typeof inicio !== 'string') return null
    const lista = Array.isArray(preguntas) ? preguntas.filter(p => typeof p === 'string') : []
    return { ronda, inicio, preguntas: lista }
  } catch {
    return null
  }
}

/** Un mensaje de Slack (evento o historial) como turno de la conversacion. */
export function turnoDeMensaje (mensaje) {
  if (esDelBot(mensaje)) {
    const estado = leerEstadoDePreguntas(mensaje)
    return estado ? { rol: 'bot', ts: mensaje.ts, preguntas: estado.preguntas } : null
  }
  const { texto, enlaces } = limpiarTextoSlack(mensaje.text)
  return { rol: 'usuario', ts: mensaje.ts, texto, enlaces, archivos: archivosDelMensaje(mensaje) }
}

const ts = m => Number(m?.ts) || 0

/**
 * Lo que vino antes del mensaje actual, leido del historial.
 *
 * `previos` son los mensajes del DM anteriores al actual (en cualquier orden;
 * conversations.history los da del mas nuevo al mas viejo).
 *
 *   - Si lo ultimo que dijo el bot fueron preguntas (y no hace tanto), el
 *     mensaje actual es una respuesta: devuelve la entrevista desde su inicio.
 *   - Si no, devuelve los mensajes sueltos del usuario que quedaron sin
 *     respuesta del bot, para leerlos junto con el actual.
 *
 * @returns {{ ronda: number, inicio: string|null, turnos: object[] }}
 */
export function reconstruirConversacion (previos = [], ahoraTs) {
  const ahora = Number(ahoraTs) || 0
  const ordenados = [...previos].sort((a, b) => ts(b) - ts(a)) // nuevo -> viejo

  const pendientes = []
  let ultimoBot = null
  for (const m of ordenados) {
    if (esDelBot(m)) { ultimoBot = m; break }
    if (!esDeLaPersona(m)) continue
    if (ahora - ts(m) > VENTANA_PENDIENTES_S) break
    pendientes.push(m)
  }

  const estado = ultimoBot && ahora - ts(ultimoBot) <= VENTANA_ENTREVISTA_S
    ? leerEstadoDePreguntas(ultimoBot)
    : null

  if (!estado) {
    const turnos = pendientes.reverse().map(turnoDeMensaje).filter(Boolean)
    return { ronda: 0, inicio: turnos[0]?.ts ?? null, turnos }
  }

  return { ronda: estado.ronda, inicio: estado.inicio, turnos: turnosDesde(previos, estado.inicio) }
}

/**
 * Los turnos de una entrevista, desde su primer mensaje. Los mensajes del bot
 * que no son preguntas (un aviso de otro ticket que cayo en medio) se saltan.
 */
export function turnosDesde (mensajes = [], inicio) {
  const desde = Number(inicio) || 0
  return [...mensajes]
    .filter(m => ts(m) >= desde && (esDelBot(m) || esDeLaPersona(m)))
    .sort((a, b) => ts(a) - ts(b))
    .map(turnoDeMensaje)
    .filter(Boolean)
}

const delUsuario = turnos => turnos.filter(t => t.rol === 'usuario')

/** Todo lo que escribio el usuario, junto: para los minimos y el plan B sin IA. */
export function textoDelUsuario (turnos) {
  return delUsuario(turnos).map(t => t.texto).filter(Boolean).join('\n')
}

/**
 * La problematica del ticket. Sigue siendo el texto del usuario tal cual (la
 * IA no la redacta): el primer mensaje, y debajo cada ronda de preguntas con lo
 * que contesto. Asi el agente ve que se pregunto y que se respondio.
 */
export function componerProblema (turnos) {
  const bloques = []
  let preguntas = null
  let respuestas = []

  const cerrarRonda = () => {
    if (!preguntas) return
    const r = respuestas.join('\n') || '(sin respuesta)'
    bloques.push(`${preguntas.map(p => `P: ${p}`).join('\n')}\nR: ${r}`)
  }

  for (const t of turnos) {
    if (t.rol === 'bot') {
      cerrarRonda()
      preguntas = t.preguntas
      respuestas = []
    } else if (preguntas) {
      if (t.texto) respuestas.push(t.texto)
    } else if (t.texto) {
      bloques.push(t.texto)
    }
  }
  cerrarRonda()

  return bloques.join('\n\n')
}

/** Enlaces y adjuntos de toda la conversacion, sin repetir. */
export function enlacesYArchivos (turnos) {
  const enlaces = [...new Set(delUsuario(turnos).flatMap(t => t.enlaces ?? []))]
  const vistos = new Set()
  const archivos = delUsuario(turnos).flatMap(t => t.archivos ?? [])
    .filter(a => !vistos.has(a.id) && vistos.add(a.id))
    .slice(0, MAX_ARCHIVOS)
  return { enlaces, archivos }
}

/** El borrador que se le propone al usuario, con todo lo que conto. */
export function armarBorrador (turnos, titulo) {
  return {
    titulo,
    problema: recortar(componerProblema(turnos), PROBLEMA_MAX),
    ...enlacesYArchivos(turnos)
  }
}

/**
 * La conversacion como la lee la IA. Solo texto y cantidades: los enlaces y
 * nombres de archivo no le aportan para decidir que falta.
 */
export function conversacionParaIa (turnos) {
  return turnos.map(t => {
    if (t.rol === 'bot') return `PREGUNTAS DEL BOT:\n${t.preguntas.map(p => `- ${p}`).join('\n')}`
    const extras = [
      t.enlaces?.length ? `${t.enlaces.length} enlace(s)` : '',
      t.archivos?.length ? `${t.archivos.length} imagen(es) adjunta(s)` : ''
    ].filter(Boolean).join(', ')
    return `USUARIO:\n${t.texto || '(sin texto)'}${extras ? `\n[${extras}]` : ''}`
  }).join('\n\n')
}
