import { profitabilityRepository as salesRepo } from '../../fico/profitability/profitability.repository.js'
import { salesRange } from '../../fico/profitability/profitability.entity.js'
import { buildProductSales } from './sales.entity.js'

// Hoy en Lima: el servidor corre en UTC y a las 19:00 de Lima ya seria manana.
const todayInLima = () => new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10)

// Misma venta y mismo periodo que FICO > Ventas y Rentabilidad: si las dos
// pantallas contaran distinto, en un mes darian cifras que no cuadran.
export async function productSales ({ granularity, date, today = todayInLima() }) {
  const period = salesRange(granularity, date, today)
  const [rows, prevRows] = await Promise.all([salesRepo.salesSold(period), salesRepo.salesSold(period.prev)])
  return buildProductSales({ period, rows, prevRows })
}
