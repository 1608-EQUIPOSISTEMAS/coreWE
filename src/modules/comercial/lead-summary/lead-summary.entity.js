// Resumen IA del historial de un lead: reglas puras, sin BD ni IA.
//
// Un lead con varios intentos obliga a leer fila por fila para saber en que
// quedo. El asesor lo necesita para retomar la llamada; el lider, para revisar
// rapido el trabajo del equipo sin abrir cada intento. Mismo resumen, los dos.
//
// El modelo NO decide nada: recibe la linea de tiempo ya armada (fechas,
// resultados del catalogo, observaciones escritas por el asesor) y la condensa.

// Por encima de esto los intentos mas viejos no cambian el resumen y solo
// alargan el prompt (y el tiempo en CPU).
export const MAX_ATTEMPTS_IN_PROMPT = 12

// Huella del historial: si cambia (intento nuevo, editado o borrado) el resumen
// guardado ya no vale. count + ultimo id + ultima modificacion lo cubren sin
// hashear textos.
export function attemptsFingerprint (attempts = []) {
  if (!attempts.length) return 'vacio'
  const ids = attempts.map(a => Number(a.lead_contact_attempt_id) || 0)
  const mods = attempts.map(a => String(a.modificado ?? '')).sort()
  return `${attempts.length}:${Math.max(...ids)}:${mods[mods.length - 1]}`
}

// Linea de tiempo en texto plano, del mas viejo al mas reciente: lo unico que
// el modelo puede usar.
export function leadFacts (lead, attempts = [], now = new Date()) {
  const lineas = [
    `Interesado: ${lead.full_name || 'sin nombre'}`,
    `Programa consultado: ${lead.programa || 'sin programa registrado'}`,
    `Estado actual del lead: ${lead.estado || 'sin estado'}${lead.interes ? `; interés ${lead.interes.toLowerCase()}` : ''}`,
    `Consulta registrada el ${fecha(lead.registration_date)} (hace ${diasDesde(lead.registration_date, now)} días).`
  ]
  if (lead.observations) lineas.push(`Observación del lead: ${limpiar(lead.observations)}`)

  // Por instante y no como texto: pg entrega Date, y String(Date) es "Mon Sep 14…".
  const orden = [...attempts].sort((a, b) => tiempo(a.contact_datetime) - tiempo(b.contact_datetime))
  const omitidos = Math.max(0, orden.length - MAX_ATTEMPTS_IN_PROMPT)
  lineas.push(`Intentos de contacto: ${orden.length}${omitidos ? ` (se muestran los ${MAX_ATTEMPTS_IN_PROMPT} más recientes)` : ''}.`)
  for (const a of orden.slice(omitidos)) {
    const partes = [
      `${fecha(a.contact_datetime)}`,
      a.tipo || 'contacto',
      a.resultado ? `resultado: ${a.resultado}` : 'sin resultado',
      a.contact_duration ? `${Math.round(a.contact_duration / 60)} min` : null,
      a.response ? `nota: "${limpiar(a.response)}"` : null
    ].filter(Boolean)
    lineas.push(`- ${partes.join('; ')}`)
  }
  return lineas.join('\n')
}

const SYSTEM = `Eres asistente de un equipo comercial de educación ejecutiva (Perú). Resumes el historial de contacto con un interesado para que el asesor retome la conversación.
Responde SOLO un objeto JSON con dos claves:
- "resumen": máximo 2 oraciones con qué pasó hasta ahora y en qué quedó (qué dijo la persona, objeciones, compromisos con fecha si los hay).
- "siguiente_paso": 1 oración con la acción concreta que conviene hacer ahora.
Usa SOLO los datos que te doy. No inventes precios, fechas ni datos del curso. Español de Perú, tono profesional.`

// Few-shot corto: con un 7B el ejemplo fija el formato mejor que la instruccion.
const EJEMPLO = {
  user: `Interesado: Carla Rojas
Programa consultado: POWER BI
Estado actual del lead: Interesado; interés alto
Consulta registrada el 02/09 (hace 6 días).
Intentos de contacto: 3.
- 02/09; Llamada; resultado: No contesta
- 03/09; WhatsApp; resultado: Revisará la información; nota: "pide temario, responde el viernes"
- 06/09; Llamada; resultado: Muy caro`,
  assistant: '{"resumen":"Carla pidió el temario de POWER BI y quedó en responder el viernes; en la última llamada (06/09) dijo que le parece caro.","siguiente_paso":"Llamarla para ofrecerle el pago en cuotas y resolver si el temario cubre lo que busca."}'
}

export function buildSummaryMessages (facts) {
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: EJEMPLO.user },
    { role: 'assistant', content: EJEMPLO.assistant },
    { role: 'user', content: facts }
  ]
}

// Valida la salida del modelo. null si no sirve (falta una clave, vacio).
export function parseSummary (obj) {
  const resumen = texto(obj?.resumen)
  const siguientePaso = texto(obj?.siguiente_paso)
  if (!resumen || !siguientePaso) return null
  return { resumen, siguiente_paso: siguientePaso }
}

// ── Utilidades ───────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000

function tiempo (d) {
  const t = new Date(d).getTime()
  return Number.isNaN(t) ? 0 : t
}

function texto (v) {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim()
  return t.length >= 10 ? t.slice(0, 600) : null
}

function limpiar (t) {
  return String(t).replace(/\s+/g, ' ').trim().slice(0, 300)
}

export function fecha (d) {
  if (!d) return 's/f'
  const x = new Date(d)
  if (Number.isNaN(x.getTime())) return 's/f'
  return `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}`
}

function diasDesde (d, now) {
  const a = new Date(d)
  a.setHours(0, 0, 0, 0)
  const b = new Date(now)
  b.setHours(0, 0, 0, 0)
  return Math.max(0, Math.round((b - a) / DAY_MS))
}
