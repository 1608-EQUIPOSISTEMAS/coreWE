// Reglas compartidas de los indicadores de RESULTADO del panel de líder.
//
// Son puras a propósito: los seis paneles (Comercial, FICO, Producto, Académica,
// Fundación, B2B) deciden su semáforo con estas mismas funciones, así "verde"
// significa lo mismo en todas las áreas y se prueba sin BD.
//
// Contrato que arma cada build<Area>Results y pinta TeamResults.vue (panel tipo
// "ejecutivo": tarjetas arriba y filas de widgets que usan todo el ancho):
//
//   { titular:  { texto, tono },                        // veredicto en 1-2 frases
//     tarjetas: [{ label, valor, unidad, ratio, tono, icono, comparativo }], // 4
//     filas:    [{ disposicion: 'hero' | 'mitad' | 'tercios' | 'completa',
//                  widgets: [Widget] }] }
//
//   hero = 60/40 (2 widgets), mitad = 50/50 (2), tercios = 3 columnas, completa = 1.
//
//   Widget común: { tipo, titulo, pista, insight: { texto, tono } | null,
//                   verTodo: { ruta, texto } | null }
//   · 'grafico'     + grafico: { tipo: 'linea'|'barras'|'barras-h', unidad, categorias,
//                     series: [{ nombre, datos, rol: 'principal'|'referencia' }],
//                     referencia: { valor, etiqueta } | null }
//   · 'comparativo' + { valor, unidad, etiqueta, ratio, tono, contra,
//                     barras: [{ label, actual, anterior, unidad }] }
//   · 'ranking'     + { unidad, items: [{ label, sublabel, valor, tono, ruta }] }   // ≤ RANKING_LIMIT
//   · 'dona'        + { unidad, total, etiquetaTotal,
//                     segmentos: [{ label, valor, tono }] }  // tono ok|warn|bad|principal|secundario|neutro
//   · 'medidor'     + { pct, etiqueta, tono, leyenda: [{ label, valor, tono }] }
//   · 'metricas'    + { items: [{ label, valor, unidad, tono, nota }] }
//   · 'tabla'       + { columnas: [{ key, label, unidad }], filas: [{ ..., tono_<key>, ruta }] } // ≤ TABLE_LIMIT
//
// unidad: 'num' | 'soles' | 'pct' | 'horas' | 'texto'. tono: 'ok' | 'warn' | 'bad' | null.
// Título = la PREGUNTA que responde ("¿Vamos bien hoy?"). Cada serie tiene tantos
// datos como categorías (null = sin dato, p.ej. horas futuras). `ruta` es una ruta
// del router del front (/academica/aulas/15113) para ir del dato al módulo.

// Un panel no es un reporte: lo que no entra en un top se ve en el módulo
// (verTodo). Listas largas empujan lo importante fuera de la pantalla.
export const RANKING_LIMIT = 5
export const TABLE_LIMIT = 10

export const TONE = { OK: 'ok', WARN: 'warn', BAD: 'bad' }

// Cuánto puede alejarse un número de su referencia antes de pasar de verde a
// ámbar (10%). Más allá del doble de esa distancia ya no es ruido del día a día.
const TOLERANCE = 0.1

// null/undefined se descartan antes de Number(): Number(null) es 0, y un día sin
// dato contado como "cero ventas" hundiría el típico.
export function median (values = []) {
  const nums = values
    .filter(v => v !== null && v !== undefined)
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
  if (!nums.length) return null
  const mid = Math.floor(nums.length / 2)
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2
}

// actual / referencia. null cuando no hay referencia: "sin histórico" no es
// lo mismo que "vas en cero", y el panel no debe pintarlo de rojo.
// Un actual null ("este mes no hay dato") tampoco es 0: Number(null) lo sería.
export function ratioOf (actual, reference) {
  if (actual === null || actual === undefined) return null
  const a = Number(actual)
  const r = Number(reference)
  if (!Number.isFinite(a) || !Number.isFinite(r) || r === 0) return null
  return a / r
}

// Porcentaje con un decimal; null si el total es cero (no hay base contra la cual medir).
export function percentOf (part, whole) {
  const w = Number(whole)
  if (!w) return null
  return Math.round((Number(part) / w) * 1000) / 10
}

// Monto para los textos (comparativo/nota). El `valor` viaja crudo y lo formatea
// el front; esto es solo para las frases armadas aquí.
export function formatSoles (amount) {
  return `S/ ${Math.round(Number(amount) || 0).toLocaleString('es-PE')}`
}

// Ventas, cobranza, llenado: mientras más, mejor.
export function toneHigherIsBetter (ratio) {
  if (ratio === null || ratio === undefined) return null
  if (ratio >= 1) return TONE.OK
  return ratio >= 1 - TOLERANCE ? TONE.WARN : TONE.BAD
}

// Bandeja pendiente, morosidad, tiempo de aprobación: mientras menos, mejor.
export function toneLowerIsBetter (ratio) {
  if (ratio === null || ratio === undefined) return null
  if (ratio <= 1) return TONE.OK
  return ratio <= 1 + TOLERANCE ? TONE.WARN : TONE.BAD
}

// Días hábiles (lunes a viernes) del mes de `now`; los transcurridos incluyen hoy.
// Es el denominador del ritmo: contra los 30 días corridos, un lunes 2 parecería
// siempre un mes perdido.
// ponytail: no descuenta feriados (catalog.we_holiday). Un feriado corre un par
// de puntos la proyección de ese mes; leer el catálogo si llega a importar.
export function businessDays (now = new Date()) {
  const year = now.getFullYear()
  const month = now.getMonth()
  const lastDay = new Date(year, month + 1, 0).getDate()
  let transcurridos = 0
  let delMes = 0
  for (let day = 1; day <= lastDay; day++) {
    const weekday = new Date(year, month, day).getDay()
    if (weekday === 0 || weekday === 6) continue
    delMes++
    if (day <= now.getDate()) transcurridos++
  }
  return { transcurridos, delMes }
}

// Avance contra una meta mensual, juzgado contra lo que ya DEBERÍA llevarse a la
// fecha: 40% de la meta el día 10 es ir adelantado; el día 25, ir tarde.
// Sin meta devuelve solo la proyección: comparar contra un 0 inventado se
// leería como incumplimiento.
export function goalProgress ({ logrado = 0, meta = null, transcurridos, delMes }) {
  const proyeccion = transcurridos ? Math.round((logrado / transcurridos) * delMes) : logrado
  if (!meta) return { pct: null, esperado: null, proyeccion, tono: null }
  const pct = Math.round((logrado / meta) * 100)
  const esperado = Math.round((transcurridos / delMes) * 100)
  const tono = pct >= esperado
    ? TONE.OK
    : pct >= esperado - TOLERANCE * 100 ? TONE.WARN : TONE.BAD
  return { pct, esperado, proyeccion, tono }
}
