import { percentOf } from '../../dashboard/results/results.entity.js'
import { goalInPeriod, lastMonths, monthsBetween, salesProgress } from '../../plancomercial/commercial-report.entity.js'
import { lastDayOfMonth } from '../../plancomercial/plancomercial.entity.js'

// Informe de Producto de una pagina por linea (plan 2026). Solo se miden las
// metas de conteo de cursos: las de encuestas (docente, NPS, testeo,
// certificados online) no tienen dato en el ERP y no se muestran.
export const PRODUCT_LINES = {
  envivo: {
    nombre: 'En vivo',
    // Online no tiene ediciones en el cronograma: la operacion es solo de En vivo.
    operacion: true,
    objetivos: [
      { clave: 'fichas', label: 'Fichas nuevas', objetivo: 'Crear 2 cursos nuevos al mes (24 fichas al año)', mensual: 2 },
      // 6 por trimestre = 2 al mes: se prorratea igual que las otras.
      { clave: 'lanzados', label: 'Cursos lanzados', objetivo: 'Lanzar 6 cursos nuevos por trimestre', mensual: 2 }
    ]
  },
  online: {
    nombre: 'Online',
    objetivos: [
      { clave: 'fichas', label: 'Cursos nuevos', objetivo: 'Crear 2 cursos nuevos al mes', mensual: 2 },
      { clave: 'mejorados', label: 'Cursos mejorados', objetivo: 'Mejorar 1 curso al mes', mensual: 1 }
    ]
  }
}

// Conteos del cronograma. meta_ok/meta_no = ediciones ya iniciadas que
// llegaron (o no) a su meta de ventas.
export const OPERATION_KEYS = ['programados', 'seguimientos', 'a5', 'cambios', 'docentes', 'meta_ok', 'meta_no']

export function countOperation (eventos) {
  const n = Object.fromEntries(OPERATION_KEYS.map((k) => [k, 0]))
  for (const e of eventos) n[e.clave]++
  return { ...n, pct_meta_ok: percentOf(n.meta_ok, n.meta_ok + n.meta_no) }
}

// La meta es mensual: un rango que corta meses la toma en proporcion a los dias.
export function goalForPeriod (mensual, period) {
  const ultimo = period.end.slice(0, 7)
  const meses = lastMonths(ultimo, monthsBetween(period.start.slice(0, 7), ultimo) + 1)
    // En decimas: con metas de 1 o 2 cursos, goalInPeriod redondea a entero y
    // una semana quedaria en meta 0.
    .map((mes) => ({ date_start: `${mes}-01`, date_end: lastDayOfMonth(`${mes}-01`), meta: mensual * 10 }))
  return goalInPeriod(meses, period) / 10
}

// El mes en curso se juzga por su ritmo (dias habiles), igual que las ventas.
function progress (cursos, mensual, period, today) {
  const meta = goalForPeriod(mensual, period)
  const { tono } = salesProgress({ logrado: cursos.length, meta, period, today })
  return { logrado: cursos.length, meta, pct: percentOf(cursos.length, meta), tono }
}

// cursos = { fichas: [{ programa, dia }], lanzados: [...], mejorados: [...] }
// operacion = [{ clave, dia }] o null si la linea no tiene cronograma.
export function buildProductReport ({ linea, period, today, cursos, operacion = null }) {
  const { nombre, objetivos } = PRODUCT_LINES[linea]
  const entre = ({ start, end }) => (c) => c.dia >= start && c.dia <= end
  return {
    linea,
    nombre,
    periodo: period,
    objetivos: objetivos.map((o) => {
      const delPeriodo = cursos[o.clave].filter(entre(period))
      return { ...o, ...progress(delPeriodo, o.mensual, period, today), cursos: delPeriodo }
    }),
    meses: lastMonths(period.end.slice(0, 7)).map((mes) => {
      const delMes = { start: `${mes}-01`, end: lastDayOfMonth(`${mes}-01`) }
      return {
        mes,
        operacion: operacion && countOperation(operacion.filter(entre(delMes))),
        ...Object.fromEntries(objetivos.map((o) => [o.clave, progress(cursos[o.clave].filter(entre(delMes)), o.mensual, delMes, today)]))
      }
    }),
    operacion: operacion && countOperation(operacion.filter(entre(period)))
  }
}
