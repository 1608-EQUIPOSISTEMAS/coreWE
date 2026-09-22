// Nota IA de un ticket interno: reglas puras, sin BD ni IA.
//
// Un ticket sirve a dos personas y la nota tambien:
//   · quien reporta (colaborador): "falta" — que dato agregar para que lo
//     atiendan sin ida y vuelta (pasos, captura, codigo del alumno...).
//   · quien atiende (agente/lider): "resumen" de una linea y un borrador de
//     primera respuesta para no arrancar de cero.
// La prioridad NO la toca la IA: la decide tickets.priority con sus reglas.

export const MAX_FALTA = 3

const SYSTEM = `Eres analista de soporte del ERP interno de un instituto de educación ejecutiva (Perú). Lees un ticket que reportó un colaborador.
Responde SOLO un objeto JSON con tres claves:
- "resumen": 1 oración con qué falla o qué se pide, y dónde.
- "falta": lista (máximo 3) de datos concretos que faltan para poder atenderlo sin volver a preguntar (por ejemplo: pasos para reproducirlo, captura del error, código o nombre del alumno/lead/edición, desde cuándo pasa). Lista vacía si no falta nada.
- "respuesta_sugerida": 2 o 3 oraciones de primera respuesta del agente de soporte al colaborador, cordial, tratando de "tú": saluda por su nombre, confirma que se revisará y pide lo que falta (si falta algo).
Usa SOLO lo que dice el ticket. No prometas plazos ni soluciones. Español de Perú.`

export function buildTicketFacts (t) {
  return [
    `Título: ${limpiar(t.title, 200)}`,
    `Descripción: ${limpiar(t.problem, 1500) || '(vacía)'}`,
    `Link adjunto: ${t.link ? 'sí' : 'no'}`,
    `Archivos adjuntos: ${Number(t.adjuntos) || 0}`,
    `Quien reporta: ${primerNombre(t.creador) || 'colaborador'} (área ${t.area || 'sin área'})`
  ].join('\n')
}

export function buildTicketMessages (facts) {
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: facts }
  ]
}

export function parseTicketNote (obj) {
  const resumen = texto(obj?.resumen, 300)
  const respuesta = texto(obj?.respuesta_sugerida, 700)
  if (!resumen || !respuesta) return null
  const falta = (Array.isArray(obj?.falta) ? obj.falta : [])
    .map(f => texto(f, 160))
    .filter(Boolean)
    .slice(0, MAX_FALTA)
  return { resumen, falta, respuesta_sugerida: respuesta }
}

// Lo que ve cada quien: el agente todo; quien reporta, sin el borrador de
// respuesta (es para el agente, verlo "respondido" por la IA confunde).
export function noteFor (payload, { canManage }) {
  if (!payload) return null
  if (canManage) return payload
  const { respuesta_sugerida: _omit, ...resto } = payload
  return resto
}

// Huella del contenido: si el reportante edita titulo o descripcion, la nota se rehace.
export function ticketFingerprint (t) {
  const s = `${t.title ?? ''}\n${t.problem ?? ''}\n${t.link ? 1 : 0}\n${Number(t.adjuntos) || 0}`
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return `${s.length}:${h >>> 0}`
}

function primerNombre (full) {
  const first = String(full ?? '').trim().split(/\s+/)[0] || ''
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
}

function texto (v, max) {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim()
  return t.length >= 3 ? t.slice(0, max) : null
}

function limpiar (v, max) {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}
