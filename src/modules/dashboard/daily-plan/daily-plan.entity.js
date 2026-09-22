// Plan del dia (Comercial): reglas puras, sin BD ni IA.
//
// Un solo proceso sirve a los dos roles. De madrugada se arma, por cada asesor,
// la lista de consultas a atender hoy y el porque; el asesor la ve como "Tu plan
// de hoy" y el lider ve la de todo su equipo con una nota de enfoque por persona.
//
// Criterio igual al de las observaciones de Academica: la PRIORIDAD y los
// MOTIVOS salen de reglas (aqui), el modelo solo REDACTA (borrador de WhatsApp
// y nota de enfoque). Un 7B que decide a quien llamar inventa; uno que redacta
// sobre datos ya calculados, no.

// Catalogos (tabla catalog). Mismos ids que usa el panel de resultados.
export const STATUS = { PAGARA: 2365, INTERESADO: 2363, PROX_INICIO: 2575 }
export const INTEREST_ALTO = 2369
export const RESULT = {
  VOY_A_PAGAR: 3129,
  MUESTRA_INTERES: 3118,
  DEVOLVER_LLAMADA: 3123,
  INTERES_PROX_INICIO: 4116,
  REVISARA_INFO: 5092,
  INDAGAR_INFO: 3121,
  PREFIERE_WHATSAPP: 4107,
  MUY_CARO: 4101,
  FALTA_DINERO: 3119,
  FUERA_PRESUPUESTO: 4102,
  PROBLEMA_HORARIO: 3120,
  NO_TIENE_TIEMPO: 3125
}

// Estados que ya no esperan gestion (pago, inscrito, cerrado, desestimado,
// eliminado, anulado) mas Indiferente: no entran al plan.
export const EXCLUDED_STATUSES = [2366, 3054, 2574, 2367, 3199, 3136, 2368]
// Ultimo resultado que cierra la puerta: no le interesa, se inscribio en otra
// institucion, numero no existe, desestimado, cliente molesto, desconoce la
// consulta, penso que era gratis.
export const DEAD_END_RESULTS = [4100, 4105, 4108, 3124, 4112, 4113, 5079]
export const ATTEMPT_PENDING_RESULT = 3169
export const LOOKBACK_DAYS = 45
export const PLAN_LIMIT = 5

const DAY_MS = 24 * 60 * 60 * 1000

// Cada regla: prioridad base, tipo (guia el tono del borrador) y motivo legible.
// Se evalua en orden; gana la primera que aplica.
const RULES = [
  {
    tipo: 'agenda',
    base: 100,
    test: (l) => l.agenda_hora,
    motivo: (l) => `Llamada agendada hoy a las ${l.agenda_hora}`
  },
  {
    tipo: 'pago',
    base: 95,
    test: (l) => l.cat_status_lead === STATUS.PAGARA || l.ult_result === RESULT.VOY_A_PAGAR,
    motivo: () => 'Dijo que va a pagar: confirmar el pago'
  },
  {
    tipo: 'nuevo',
    base: 85,
    test: (l, now) => !l.ult_result && daysBetween(l.registration_date, now) <= 3,
    motivo: (l, now) => {
      const d = daysBetween(l.registration_date, now)
      return d === 0 ? 'Consulta de hoy, aún sin contactar' : `Consulta de hace ${d} día${d === 1 ? '' : 's'}, aún sin contactar`
    }
  },
  {
    tipo: 'interes',
    base: 75,
    test: (l) => [RESULT.MUESTRA_INTERES, RESULT.DEVOLVER_LLAMADA, RESULT.INTERES_PROX_INICIO].includes(l.ult_result),
    motivo: (l) => `Último contacto: "${l.ult_result_label}"`
  },
  {
    tipo: 'interes',
    base: 70,
    test: (l) => [STATUS.INTERESADO, STATUS.PROX_INICIO].includes(l.cat_status_lead),
    motivo: (l) => (l.cat_status_lead === STATUS.PROX_INICIO ? 'Espera el próximo inicio' : 'Marcado como interesado')
  },
  {
    tipo: 'seguimiento',
    base: 55,
    test: (l) => [RESULT.REVISARA_INFO, RESULT.INDAGAR_INFO, RESULT.PREFIERE_WHATSAPP].includes(l.ult_result),
    motivo: (l) => `Último contacto: "${l.ult_result_label}"`
  },
  {
    tipo: 'interes',
    base: 45,
    test: (l) => l.cat_interest_level === INTEREST_ALTO,
    motivo: () => 'Nivel de interés alto'
  },
  {
    tipo: 'precio',
    base: 40,
    test: (l) => [RESULT.MUY_CARO, RESULT.FALTA_DINERO, RESULT.FUERA_PRESUPUESTO].includes(l.ult_result),
    motivo: (l) => `Objeción de precio ("${l.ult_result_label}"): ofrecer cuotas`
  },
  {
    tipo: 'horario',
    base: 35,
    test: (l) => [RESULT.PROBLEMA_HORARIO, RESULT.NO_TIENE_TIEMPO].includes(l.ult_result),
    motivo: (l) => `Objeción de tiempo ("${l.ult_result_label}"): mostrar otra modalidad`
  }
]

// Prioridad de una consulta hoy, o null si no entra al plan.
export function scoreLead (lead, now = new Date()) {
  if (DEAD_END_RESULTS.includes(lead.ult_result)) return null
  if (EXCLUDED_STATUSES.includes(lead.cat_status_lead)) return null

  const rule = RULES.find(r => r.test(lead, now))
  if (!rule) return null

  let score = rule.base
  const notas = []
  if (rule.base < 45 && lead.cat_interest_level === INTEREST_ALTO) score += 10
  const sinContacto = lead.ult_fecha ? daysBetween(lead.ult_fecha, now) : null
  if (sinContacto !== null && sinContacto >= 4 && rule.tipo !== 'agenda') {
    score += 8
    notas.push(`lleva ${sinContacto} días sin contacto`)
  }
  // Ya se le hablo hoy y no hay agenda: que no desplace a quien espera.
  if (sinContacto === 0 && rule.tipo !== 'agenda') score -= 30

  const motivo = [rule.motivo(lead, now), ...notas].join('; ')
  return { score, tipo: rule.tipo, motivo }
}

// Los PLAN_LIMIT leads de mayor prioridad de un asesor. Empate: el mas reciente.
export function pickPlanLeads (leads, now = new Date(), limit = PLAN_LIMIT) {
  const scored = []
  for (const lead of leads) {
    const s = scoreLead(lead, now)
    if (s) scored.push({ lead, ...s })
  }
  scored.sort((a, b) => b.score - a.score || b.lead.lead_id - a.lead.lead_id)
  return {
    candidatos: scored.length,
    leads: scored.slice(0, limit).map(({ lead, score, tipo, motivo }) => ({
      lead_id: lead.lead_id,
      nombre: lead.full_name,
      programa: lead.programa || null,
      telefono: waPhone(lead.origin_phone, lead.country_code),
      prioridad: score,
      tipo,
      motivo,
      whatsapp: null
    }))
  }
}

// Numero para wa.me: codigo de pais + numero, solo digitos. Si el numero ya
// trae el codigo (se importo asi), no se duplica.
export function waPhone (phone, countryCode) {
  const num = String(phone ?? '').replace(/\D/g, '')
  if (!num) return null
  const cc = String(countryCode ?? '').replace(/\D/g, '')
  if (!cc || num.startsWith(cc) && num.length > 9) return num
  return cc + num
}

// ── Cifras del mes por asesor (deterministas) ─────────────────────────────

// Dias habiles (lun-vie) del mes: transcurridos hasta hoy inclusive y totales.
export function businessDays (now = new Date()) {
  const y = now.getFullYear()
  const m = now.getMonth()
  const last = new Date(y, m + 1, 0).getDate()
  let total = 0
  let transcurridos = 0
  for (let d = 1; d <= last; d++) {
    const dow = new Date(y, m, d).getDay()
    if (dow === 0 || dow === 6) continue
    total++
    if (d <= now.getDate()) transcurridos++
  }
  return { total, transcurridos }
}

// Una fila de fetchComercialRaw().asesores + su seguimiento -> cifras y tono.
// esperado = meta prorrateada a los dias habiles ya corridos: el dia 10 no se
// le puede exigir la meta entera.
export function advisorMonth (row, seguimiento = null, now = new Date()) {
  const { total, transcurridos } = businessDays(now)
  const meta = row?.meta ?? null
  const ventas = row?.mes ?? 0
  const esperado = meta ? Math.round((meta * transcurridos) / Math.max(1, total)) : null
  let tono = 'neutro'
  if (esperado !== null) {
    tono = ventas >= esperado ? 'ok' : ventas >= esperado * 0.7 ? 'warn' : 'bad'
  }
  const en24h = seguimiento?.consultas
    ? Math.round((seguimiento.en_24h / seguimiento.consultas) * 100)
    : null
  return {
    ventas,
    meta,
    esperado,
    ventas_mes_anterior_al_dia: row?.mes_prev_tramo ?? null,
    consultas_mes: row?.consultas ?? 0,
    sin_gestion: row?.sin_gestion ?? 0,
    contacto_24h_pct: en24h,
    tono
  }
}

// Nota de respaldo cuando el modelo no responde: mismas cifras, sin redaccion.
export function fallbackFocus (nombre, mes, plan) {
  const partes = []
  if (mes.meta) partes.push(`${mes.ventas} de ${mes.meta} ventas del mes (a la fecha tocaban ${mes.esperado})`)
  else partes.push(`${mes.ventas} ventas en el mes`)
  if (mes.sin_gestion) partes.push(`${mes.sin_gestion} consultas sin gestión`)
  partes.push(`${plan.leads.length} consultas priorizadas para hoy`)
  return `${primerNombre(nombre)}: ${partes.join(', ')}.`
}

// ── Prompts ──────────────────────────────────────────────────────────────

const WHATSAPP_SYSTEM = `Eres asesor comercial de WE Educación Ejecutiva (Perú), que dicta cursos y diplomados para profesionales.
Escribes mensajes de WhatsApp para retomar el contacto con un interesado.
Reglas:
- Máximo 3 oraciones, tono cordial y profesional, en español de Perú, tratando de "usted".
- Saluda por el primer nombre. No firmes el mensaje.
- NUNCA menciones precios, montos, descuentos, fechas, horarios ni vacantes: no los conoces.
- No inventes datos del curso. Si no hay nombre de programa, di "el programa que consultó".
- Termina con una pregunta corta que invite a responder.
- Como máximo un emoji.
Devuelve SOLO el texto del mensaje.`

// Que busca el mensaje segun la regla que puso al lead en el plan.
const WHATSAPP_OBJETIVO = {
  agenda: 'Confirmar la llamada que quedó agendada para hoy.',
  pago: 'Acompañar el pago que dijo que haría y ofrecer ayuda con el proceso.',
  nuevo: 'Primer contacto: agradecer la consulta y ofrecer resolver sus dudas.',
  interes: 'Retomar su interés y proponer el siguiente paso (resolver dudas o inscribirse).',
  seguimiento: 'Preguntar si pudo revisar la información enviada y si tiene dudas.',
  precio: 'Ofrecer facilidades de pago en cuotas, sin mencionar montos.',
  horario: 'Ofrecer conversar sobre modalidades u horarios que le acomoden, sin dar horarios concretos.'
}

// Few-shot corto: con un 7B los ejemplos pesan mas que las instrucciones.
const WHATSAPP_EJEMPLO = {
  user: 'Nombre: Carla\nPrograma: POWER BI\nObjetivo: Preguntar si pudo revisar la información enviada y si tiene dudas.',
  assistant: 'Hola Carla, ¿cómo está? Le escribo de WE Educación Ejecutiva para saber si pudo revisar la información del programa POWER BI. ¿Tiene alguna duda que pueda resolverle hoy?'
}

export function buildWhatsappMessages (planLead) {
  const user = [
    `Nombre: ${primerNombre(planLead.nombre)}`,
    `Programa: ${planLead.programa || '(sin programa registrado)'}`,
    `Objetivo: ${WHATSAPP_OBJETIVO[planLead.tipo] ?? WHATSAPP_OBJETIVO.interes}`
  ].join('\n')
  return [
    { role: 'system', content: WHATSAPP_SYSTEM },
    { role: 'user', content: WHATSAPP_EJEMPLO.user },
    { role: 'assistant', content: WHATSAPP_EJEMPLO.assistant },
    { role: 'user', content: user }
  ]
}

const FOCUS_SYSTEM = {
  asesor: `Eres un coach comercial. Escribes al asesor su enfoque del día en 2 oraciones: primero cómo va, luego qué priorizar hoy.
Usa SOLO las cifras que te doy, sin inventar otras. Tono motivador y directo, tratando de "tú". Sin saludos ni despedidas.
Devuelve SOLO las 2 oraciones.`,
  lider: `Eres un coach de líderes comerciales. Escribes al líder, sobre UNO de sus asesores, 2 oraciones: primero el diagnóstico, luego una acción concreta que el líder puede hacer hoy con esa persona.
Usa SOLO las cifras que te doy, sin inventar otras. Tono profesional y directo. Sin saludos ni despedidas.
Devuelve SOLO las 2 oraciones.`
}

// Hechos del asesor en texto plano: lo unico que el modelo puede usar.
export function advisorFacts (nombre, mes, plan) {
  const lineas = [`Asesor: ${primerNombre(nombre)}`]
  if (mes.meta) {
    lineas.push(`Ventas del mes: ${mes.ventas} de una meta de ${mes.meta}; a la fecha debería llevar ${mes.esperado}.`)
  } else {
    lineas.push(`Ventas del mes: ${mes.ventas} (sin meta cargada).`)
    if (mes.ventas_mes_anterior_al_dia !== null) lineas.push(`El mes pasado a esta misma fecha llevaba ${mes.ventas_mes_anterior_al_dia}.`)
  }
  lineas.push(`Consultas sin ninguna gestión (últimos 30 días): ${mes.sin_gestion}.`)
  if (mes.contacto_24h_pct !== null) lineas.push(`Consultas contactadas en menos de 24 h: ${mes.contacto_24h_pct}%.`)
  const porTipo = countBy(plan.leads, l => l.tipo)
  const detalle = Object.entries(porTipo).map(([t, n]) => `${n} ${TIPO_LABEL[t] ?? t}`).join(', ')
  lineas.push(`Consultas priorizadas para hoy: ${plan.leads.length} de ${plan.candidatos} con opción${detalle ? ` (${detalle})` : ''}.`)
  return lineas.join('\n')
}

export function buildFocusMessages (audiencia, facts) {
  return [
    { role: 'system', content: FOCUS_SYSTEM[audiencia] },
    { role: 'user', content: facts }
  ]
}

const TEAM_SYSTEM = `Eres un coach de líderes comerciales. Con los datos del equipo escribe al líder un resumen del día en 3 oraciones: cómo va el equipo, quién necesita apoyo y por qué, y la prioridad de hoy.
Usa SOLO los nombres y cifras que te doy. Tono profesional y directo. Sin saludos ni despedidas.
Devuelve SOLO las 3 oraciones.`

export function buildTeamMessages (asesores) {
  const facts = asesores.map(a => advisorFacts(a.nombre, a.mes, a.plan)).join('\n\n')
  return [
    { role: 'system', content: TEAM_SYSTEM },
    { role: 'user', content: facts }
  ]
}

// Limpia la salida del modelo: comillas envolventes, prefijos tipo "Mensaje:".
export function cleanModelText (text) {
  // Un solo parrafo: el 7B a veces parte "2 oraciones" en dos bloques y la
  // tarjeta del panel se desarma.
  let t = String(text ?? '').replace(/\s*\n+\s*/g, ' ').trim()
  t = t.replace(/^(mensaje|respuesta|whatsapp)\s*:\s*/i, '')
  if (/^["“].*["”]$/s.test(t)) t = t.slice(1, -1).trim()
  return t
}

// Salvaguarda: un borrador que cite montos o porcentajes se descarta. El prompt
// lo prohibe, pero un 7B a veces igual inventa un precio.
export function mentionsMoney (text) {
  return /(S\/|US\$|\$|soles|d[oó]lares|\d+\s*%)/i.test(String(text ?? ''))
}

// ── Utilidades ───────────────────────────────────────────────────────────

const TIPO_LABEL = {
  agenda: 'con llamada agendada',
  pago: 'por confirmar pago',
  nuevo: 'nuevas sin contactar',
  interes: 'con interés',
  seguimiento: 'en seguimiento',
  precio: 'con objeción de precio',
  horario: 'con objeción de tiempo'
}

export function primerNombre (full) {
  const first = String(full ?? '').trim().split(/\s+/)[0] || ''
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
}

function countBy (arr, fn) {
  const out = {}
  for (const x of arr) out[fn(x)] = (out[fn(x)] ?? 0) + 1
  return out
}

function startOfDay (d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function daysBetween (from, to) {
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS)
}
