import { profitabilityRepository as repo } from './profitability.repository.js'
import { DomainError } from '../../../shared/errors.js'
import {
  salesRange, profitRange, buildSalesView, buildProfitView, validateMarketingRows
} from './profitability.entity.js'

const SALES_SOURCES = {
  vendido: range => repo.salesSold(range),
  cobrado: range => repo.salesCollected(range)
}

// Hoy en Lima: el servidor corre en UTC y a las 19:00 de Lima ya seria manana.
const todayInLima = () => new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10)

export async function salesByLine ({ granularity, date, measure, today = todayInLima() }) {
  const load = SALES_SOURCES[measure]
  if (!load) throw new DomainError('Medida invalida: vendido o cobrado')
  const period = salesRange(granularity, date, today)
  const [rows, prevRows] = await Promise.all([load(period), load(period.prev)])
  return buildSalesView({ period, measure, rows, prevRows })
}

export async function profitByProgram ({ granularity, date }) {
  const period = profitRange(granularity, date)
  const [sales, editions, spend] = await Promise.all([
    repo.salesSold(period),
    repo.editionsStarting(period),
    repo.marketingSpend(period)
  ])
  return buildProfitView({ period, sales, editions, spend })
}

export async function costInputs ({ year }) {
  const [tarifas, publicidad] = await Promise.all([repo.instructorRates({ year }), repo.marketingYear({ year })])
  return { year, tarifas, publicidad }
}

export async function saveInstructorRate ({ instructor_id: instructorId, hourly_rate: rate, userId }) {
  if (rate !== null && !(Number(rate) >= 0)) throw new DomainError('La tarifa debe ser 0 o mayor')
  await repo.saveInstructorRate({ instructorId, rate: rate === null ? null : Number(rate), userId })
  return { ok: true }
}

export async function saveMarketing ({ year, rows, userId }) {
  const valid = validateMarketingRows(year, rows)
  await repo.saveMarketing({ rows: valid, userId })
  return { saved: valid.length }
}
