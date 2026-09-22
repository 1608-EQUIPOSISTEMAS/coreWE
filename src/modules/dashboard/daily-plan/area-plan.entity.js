// Plan del dia de las areas que no son Comercial (FICO, Academica, Producto...):
// reglas puras, sin BD ni IA.
//
// Comercial reparte consultas por asesor; estas areas no: trabajan una cola
// comun (la bandeja de FICO, las aulas sin notas, las ediciones en riesgo). Por
// eso el plan es UNO por area y se lee distinto segun quien lo abre:
//   · colaborador: "que atender primero hoy" + la lista de pendientes.
//   · lider: el resumen del area + los mismos pendientes para repartirlos.
//
// La fuente es el panel de resultados del area (dashboard/results), que ya
// calcula con reglas los indicadores y las listas de trabajo. El modelo solo
// REDACTA sobre eso: mismo criterio que el plan de Comercial.
import { formatSoles } from '../results/results.entity.js'

// Areas con plan propio. area = clave que se guarda en ai_daily_plans.area.
// B2B y Fundacion estan definidas pero no van por defecto: su panel no tiene
// una lista de trabajo (solo rankings de ventas), el plan no tendria que priorizar.
export const AREA_PLANS = {
  FICO: { leaderRole: 'LIDER_FICO', memberRole: 'FICO', label: 'FICO' },
  ACADEMICA: { leaderRole: 'LIDER_ACADEMICA', memberRole: 'ACADEMICA', label: 'Académica' },
  PRODUCTO: { leaderRole: 'LIDER_PRODUCTO', memberRole: 'PRODUCTO', label: 'Producto' },
  B2B: { leaderRole: 'LIDER_B2B', memberRole: 'B2B', label: 'B2B' },
  FUNDACION: { leaderRole: 'LIDER_FUNDACION', memberRole: 'FUNDACION', label: 'Fundación' }
}

export const DEFAULT_AREAS = ['COMERCIAL', 'FICO', 'ACADEMICA', 'PRODUCTO']

// Areas encendidas: AI_DAILY_PLAN_AREAS=COMERCIAL,FICO,... (default DEFAULT_AREAS).
// Lo desconocido se ignora: un typo en el .env no debe tumbar la generacion.
export function enabledAreas (env = process.env) {
  const raw = env.AI_DAILY_PLAN_AREAS
  const lista = raw ? raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : DEFAULT_AREAS
  return [...new Set(lista)].filter(a => a === 'COMERCIAL' || Object.hasOwn(AREA_PLANS, a))
}

// Area cuyo plan le toca a un conjunto de roles: la que lidera, o si no la de
// su rol de colaborador. null si no pertenece a ninguna con plan.
export function areaForRoles (roles = [], areas = Object.keys(AREA_PLANS)) {
  for (const area of areas) {
    if (roles.includes(AREA_PLANS[area]?.leaderRole)) return { area, rol: 'lider' }
  }
  for (const area of areas) {
    if (roles.includes(AREA_PLANS[area]?.memberRole)) return { area, rol: 'colaborador' }
  }
  return null
}

export const AREA_PENDING_LIMIT = 8

const TONE_ORDER = { bad: 0, warn: 1 }

// Pendientes del area = filas con semaforo rojo/ambar de las tablas y rankings
// del panel. Esas listas ya son "lo que hay que atender" (ventas que mas
// esperan, aulas sin notas, ediciones en riesgo...). Lo verde no es pendiente.
export function extractPendientes (results, limit = AREA_PENDING_LIMIT) {
  const out = []
  const vistos = new Set()
  for (const fila of results?.filas ?? []) {
    for (const w of fila?.widgets ?? []) {
      const items = w.tipo === 'tabla' ? tablaItems(w) : w.tipo === 'ranking' ? rankingItems(w) : []
      for (const it of items) {
        const clave = `${it.grupo}|${it.titulo}|${it.detalle}`
        if (vistos.has(clave)) continue
        vistos.add(clave)
        out.push(it)
      }
    }
  }
  // Estable: dentro del mismo tono se respeta el orden del panel (que ya
  // ordena lo mas urgente primero en cada lista).
  return out
    .map((it, i) => ({ it, i }))
    .sort((a, b) => TONE_ORDER[a.it.tono] - TONE_ORDER[b.it.tono] || a.i - b.i)
    .slice(0, limit)
    .map(({ it }) => it)
}

function rankingItems (w) {
  return (w.items ?? [])
    .filter(it => Object.hasOwn(TONE_ORDER, it.tono ?? ''))
    .map(it => ({
      grupo: grupoDe(w.titulo),
      titulo: String(it.label ?? ''),
      detalle: [it.sublabel, formatValue(it.valor, w.unidad)].filter(Boolean).join(' · '),
      tono: it.tono,
      ruta: it.ruta ?? w.verTodo?.ruta ?? null
    }))
}

function tablaItems (w) {
  const cols = w.columnas ?? []
  const texto = cols.filter(c => c.unidad === 'texto')
  return (w.filas ?? [])
    .map(f => ({ f, tono: peorTono(f) }))
    .filter(({ tono }) => tono)
    .map(({ f, tono }) => ({
      grupo: grupoDe(w.titulo),
      titulo: String(f[texto[0]?.key] ?? ''),
      detalle: [
        ...texto.slice(1).map(c => f[c.key]),
        ...cols.filter(c => c.unidad !== 'texto' && f[c.key] !== null && f[c.key] !== undefined)
          .map(c => `${c.label}: ${formatValue(f[c.key], c.unidad)}`)
      ].filter(Boolean).join(' · '),
      tono,
      ruta: f.ruta ?? w.verTodo?.ruta ?? null
    }))
}

// El peor semaforo de una fila de tabla (tono_<columna>).
function peorTono (fila) {
  const tonos = Object.entries(fila).filter(([k]) => k.startsWith('tono_')).map(([, v]) => v)
  if (tonos.includes('bad')) return 'bad'
  if (tonos.includes('warn')) return 'warn'
  return null
}

// El titulo de un widget es una pregunta ("¿Qué aulas cerraron sin notas?");
// como grupo se lee mejor sin signos: "Qué aulas cerraron sin notas".
export function grupoDe (titulo) {
  return String(titulo ?? '').replace(/^¿\s*/, '').replace(/\s*\?$/, '').trim()
}

export function formatValue (valor, unidad) {
  if (valor === null || valor === undefined || valor === '') return null
  if (unidad === 'pct') return `${valor}%`
  if (unidad === 'soles') return formatSoles(valor)
  if (unidad === 'horas') return `${valor} h`
  return String(valor)
}

// Lo que el modelo puede usar, en texto plano: veredicto, tarjetas y pendientes.
export function areaFacts (label, results, pendientes) {
  const lineas = [`Área: ${label}`]
  if (results?.titular?.texto) lineas.push(`Veredicto del día: ${results.titular.texto}`)
  for (const t of results?.tarjetas ?? []) {
    const valor = formatValue(t.valor, t.unidad)
    if (valor === null) continue
    lineas.push(`${t.label}: ${valor}${t.comparativo ? ` (${t.comparativo})` : ''}.`)
  }
  if (pendientes.length) {
    lineas.push('Pendientes priorizados (del más urgente al menos):')
    pendientes.forEach((p, i) => lineas.push(`${i + 1}. [${p.grupo}] ${p.titulo}${p.detalle ? ` — ${p.detalle}` : ''}`))
  } else {
    lineas.push('No hay pendientes en rojo ni en ámbar.')
  }
  return lineas.join('\n')
}

const AREA_SYSTEM = {
  lider: `Eres un coach de líderes de un instituto de educación ejecutiva (Perú). Con los datos del área escribe al líder un resumen del día en 3 oraciones: cómo va el área, qué es lo más urgente y por qué, y una acción concreta para repartir hoy en su equipo.
Usa SOLO los nombres y cifras que te doy, sin inventar otras. Tono profesional y directo. Sin saludos ni despedidas.
Devuelve SOLO las 3 oraciones.`,
  colaborador: `Eres un compañero experimentado de un instituto de educación ejecutiva (Perú). Con los datos del área escribe a un colaborador su enfoque del día en 2 oraciones: primero qué atender antes que nada y por qué, luego qué sigue después.
Usa SOLO los nombres y cifras que te doy, sin inventar otras. Tono cercano y directo, tratando de "tú". Sin saludos ni despedidas.
Devuelve SOLO las 2 oraciones.`
}

export function buildAreaMessages (audiencia, facts) {
  return [
    { role: 'system', content: AREA_SYSTEM[audiencia] },
    { role: 'user', content: facts }
  ]
}

// Respaldo sin modelo: el veredicto del panel ya es una frase honesta.
export function areaFallback (results, pendientes) {
  const base = results?.titular?.texto || 'Sin veredicto del panel para hoy.'
  if (!pendientes.length) return base
  return `${base} Lo primero hoy: ${pendientes[0].titulo} (${pendientes[0].grupo.toLowerCase()}).`
}

// Fila que se guarda por area (user_id NULL: el plan es del area, no de una persona).
export function buildAreaPayload ({ area, results, resumenLider, enfoqueColaborador, pendientes }) {
  const respaldo = areaFallback(results, pendientes)
  return {
    area,
    label: AREA_PLANS[area]?.label ?? area,
    titular: results?.titular ?? null,
    tarjetas: (results?.tarjetas ?? []).map(t => ({
      label: t.label, valor: formatValue(t.valor, t.unidad), tono: t.tono ?? null, comparativo: t.comparativo ?? null
    })),
    pendientes,
    resumen_lider: resumenLider ?? respaldo,
    enfoque_colaborador: enfoqueColaborador ?? respaldo,
    ia: { resumen: !!resumenLider, enfoque: !!enfoqueColaborador }
  }
}
