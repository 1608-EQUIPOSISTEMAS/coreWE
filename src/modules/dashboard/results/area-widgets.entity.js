import { median } from './results.entity.js'
import { MONTHS_ES } from '../dashboard.entity.js'

// Piezas comunes para armar los paneles de área: el widget base, las filas sin
// huecos, la diferencia en palabras y, para los paneles que se miden contra su
// PROPIO histórico mensual (Fundación y B2B), las filas de 7 meses con `meses_atras`.

// Todo widget lleva los campos comunes del contrato aunque no los use: el front
// no tiene que adivinar si `insight` falta o viene vacío.
export const widget = (tipo, titulo, campos) => ({ tipo, titulo, pista: null, insight: null, verTodo: null, ...campos })

export const monthAgo = (rows, n) => rows.find(r => r.meses_atras === n)
export const previousMonths = (rows) => rows.filter(r => r.meses_atras > 0)

// Siete meses, del más viejo al actual, con la mediana de los 6 cerrados como
// línea de referencia: separa un mes flojo de una caída sostenida. null sin filas
// (no se dibuja un gráfico vacío).
export function monthlyChart ({ serie, unidad, rows, valorDelMes, now, tipo = 'barras' }) {
  if (!rows.length) return null
  const orden = [...rows].sort((a, b) => b.meses_atras - a.meses_atras)
  const referencia = median(previousMonths(rows).map(valorDelMes))
  return {
    tipo,
    unidad,
    categorias: orden.map(r => monthLabel(now, r.meses_atras)),
    series: [{ nombre: serie, datos: orden.map(valorDelMes), rol: 'principal' }],
    referencia: referencia === null ? null : { valor: referencia, etiqueta: 'mediana 6 meses' }
  }
}

// El mes en curso se rotula "(al día)": su barra todavía no es comparable.
export function monthLabel (now, mesesAtras) {
  const mes = new Date(now.getFullYear(), now.getMonth() - mesesAtras, 1).getMonth() + 1
  const nombre = MONTHS_ES[String(mes).padStart(2, '0')]
  return mesesAtras === 0 ? `${nombre} (al día)` : nombre
}

// "12% sobre" / "30% bajo" / "igual que": la diferencia contra la referencia en palabras.
export function differenceText (ratio) {
  const cambio = Math.round((ratio - 1) * 100)
  if (cambio === 0) return 'igual que'
  return `${Math.abs(cambio)}% ${cambio > 0 ? 'sobre' : 'bajo'}`
}

const WIDGETS_POR_DISPOSICION = { hero: 2, mitad: 2, tercios: 3, completa: 1 }
const DISPOSICION_POR_CANTIDAD = { 1: 'completa', 2: 'mitad', 3: 'tercios' }

// Una fila sin huecos: los widgets que no tienen datos honestos llegan en null y
// se sacan; si quedan menos, la fila se reacomoda (un tercio vacío desperdicia
// espacio y un gráfico en blanco se lee como "cero").
export function row (disposicion, widgets) {
  const presentes = widgets.filter(Boolean)
  if (!presentes.length) return null
  return {
    disposicion: presentes.length === WIDGETS_POR_DISPOSICION[disposicion]
      ? disposicion
      : DISPOSICION_POR_CANTIDAD[presentes.length],
    widgets: presentes
  }
}
