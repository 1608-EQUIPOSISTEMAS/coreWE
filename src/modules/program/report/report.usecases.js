import { productReportRepository as repo, LINE_MODALITY } from './report.repository.js'
import { DomainError } from '../../../shared/errors.js'
import { buildProductReport, PRODUCT_LINES } from './report.entity.js'
import { lastMonths } from '../../plancomercial/commercial-report.entity.js'
import { lastDayOfMonth } from '../../plancomercial/plancomercial.entity.js'

// Hoy en Lima: el servidor corre en UTC y a las 19:00 de Lima ya seria manana.
const todayInLima = () => new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10)

export async function reporteProducto ({ linea, date_start: start, date_end: end, today = todayInLima() }) {
  if (start > end) throw new DomainError('La fecha de inicio no puede ser posterior a la de fin')
  // Los 6 meses de la serie y el rango elegido, que puede empezar antes.
  const meses = lastMonths(end.slice(0, 7))
  const rango = {
    modality: LINE_MODALITY[linea],
    from: [`${meses[0]}-01`, start].sort()[0],
    to: [lastDayOfMonth(`${meses.at(-1)}-01`), end].sort().at(-1)
  }
  const [fichas, lanzados, mejorados, operacion] = await Promise.all([
    repo.newPrograms(rango),
    repo.launchedPrograms(rango),
    repo.improvedPrograms(rango),
    PRODUCT_LINES[linea].operacion ? repo.scheduleEvents({ ...rango, today }) : null
  ])
  return buildProductReport({ linea, period: { start, end }, today, cursos: { fichas, lanzados, mejorados }, operacion })
}
