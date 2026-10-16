// Medicion de la bandeja "Llamar hoy": ¿los clientes que se llamaron compraron
// mas que los del grupo de control (sorteados y no llamados)?
//
// Se compara DENTRO del mismo segmento (4.4% contra 4.4%, 9% contra 9%): el
// reparto llama primero a los mejores, asi que juntar segmentos haria ganar a
// los llamados aunque la llamada no sirviera.
//
// Y solo se declara ganador si la diferencia no se explica por azar: la prueba
// A/A del 15/10/26 (fechas pasadas, NADIE llamo) dio "lift 1.8" en un segmento
// (4.3% vs 2.4%, 1247 vs 340 casos). Con muestras chicas el azar inventa
// diferencias; z de dos proporciones al 95%.

// Compra a 30 dias de asignado: la ventana del pronostico (outlook.entity.js).
export const MEASURE_WINDOW_DAYS = 30
// Con menos casos por lado ni la prueba sirve: no se muestra nada.
export const MIN_GROUP_SAMPLE = 30
const Z_95 = 1.96

const rate = (bought, n) => (n ? Math.round((1000 * bought) / n) / 10 : null)

// Una probabilidad esperada por segmento (outlook.entity.js expectedProbability).
const SEGMENT_LABEL = {
  9: 'Alta · cliente que volvió', 5.2: 'Alta · consulta de la semana',
  4.4: 'Media · cliente que volvió', 4.1: 'Media · consulta de la semana'
}

// ¿La diferencia entre dos proporciones supera lo que el azar daria al 95%?
export function differsBeyondChance (a, b) {
  const pooled = (a.compraron + b.compraron) / (a.n + b.n)
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.n + 1 / b.n))
  if (!se) return false
  return Math.abs(a.compraron / a.n - b.compraron / b.n) / se >= Z_95
}

// ¿Lo esperado cae dentro del margen de error de lo observado? Si no, el % que
// ve el asesor esta inflado (o corto) y hay que recalibrarlo.
export function withinMargin (group, expectedPct) {
  const p = group.compraron / group.n
  const margin = Z_95 * Math.sqrt(Math.max(p * (1 - p), 1e-4) / group.n)
  return Math.abs(p - expectedPct / 100) <= margin
}

// rows: { is_control, probability, total, compraron } de asignaciones maduras.
export function buildMeasurement (rows) {
  const segments = [...new Set(rows.map((r) => Number(r.probability)))].sort((a, b) => b - a)
  const group = (prob, control) => {
    const g = rows.filter((r) => Number(r.probability) === prob && r.is_control === control)
    const n = g.reduce((s, r) => s + r.total, 0)
    const bought = g.reduce((s, r) => s + r.compraron, 0)
    return { n, compraron: bought, tasa: rate(bought, n) }
  }
  return segments.map((prob) => {
    const llamados = group(prob, false)
    const control = group(prob, true)
    const comparable = llamados.n >= MIN_GROUP_SAMPLE && control.n >= MIN_GROUP_SAMPLE
    const significativo = comparable && differsBeyondChance(llamados, control)
    return {
      segmento: SEGMENT_LABEL[prob] ?? `${prob}%`,
      esperado: prob,
      llamados,
      control,
      // Lift = cuantas veces mas compra el llamado que el no llamado. Se informa
      // siempre que haya muestra, pero solo cuenta si es significativo.
      lift: comparable && control.tasa ? Math.round((10 * llamados.tasa) / control.tasa) / 10 : null,
      significativo,
      // Calibracion: lo que paso SIN intervenir (control) contra lo que el modelo dijo.
      calibrado: comparable ? withinMargin(control, prob) : null,
      veredicto: !comparable
        ? 'SIN_MUESTRA'
        : !significativo ? 'AZAR' : llamados.tasa > control.tasa ? 'FUNCIONA' : 'EMPEORA'
    }
  })
}
