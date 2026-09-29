import { ficoReportRepository as repo } from './report.repository.js'
import { DomainError } from '../../../shared/errors.js'
import { buildFicoReport } from './report.entity.js'
import { lastMonths } from '../../plancomercial/commercial-report.entity.js'
import { lastDayOfMonth } from '../../plancomercial/plancomercial.entity.js'

// Hoy en Lima: el servidor corre en UTC y a las 19:00 de Lima ya seria manana.
const todayInLima = () => new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10)

export async function reporteFico ({ date_start: start, date_end: end, today = todayInLima() }) {
  if (start > end) throw new DomainError('La fecha de inicio no puede ser posterior a la de fin')
  const meses = lastMonths(end.slice(0, 7))
  // Los 6 meses de la serie y el rango elegido, que puede empezar antes.
  const from = [`${meses[0]}-01`, start].sort()[0]
  // ...y el mes de hoy, que la proyeccion necesita aunque el periodo sea viejo.
  const to = [lastDayOfMonth(`${meses.at(-1)}-01`), end, lastDayOfMonth(`${today.slice(0, 7)}-01`)].sort().at(-1)
  const [cuotas, cobros, pendientes, porMedio] = await Promise.all([
    repo.installmentsDue({ from, to }),
    repo.collectedByDay({ from, to }),
    repo.pendingInstallments(),
    repo.collectedByMethod({ from: start, to: end })
  ])
  return buildFicoReport({ period: { start, end }, today, cuotas, cobros, pendientes, porMedio })
}
