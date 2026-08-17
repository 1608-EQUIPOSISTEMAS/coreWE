// Reglas puras del crecimiento en redes sociales. Sin BD, sin red, sin reloj oculto.
//
// Regla central: el crecimiento NUNCA se almacena, se deriva de dos snapshots
// consecutivos. En el Google Sheet que este módulo reemplaza el delta vivía como
// celda aparte del acumulado y por eso se desincronizaba (semanas duplicadas,
// deltas que no cuadraban con los seguidores de la fila de arriba).
import { DomainError } from '../../shared/errors.js'

const MS_PER_DAY = 24 * 60 * 60 * 1000
const MS_PER_WEEK = 7 * MS_PER_DAY

// La semana se decide por el calendario de Lima, no por el del servidor: un
// snapshot tomado un domingo por la noche en Lima ya es lunes en UTC y caería
// en la semana siguiente.
const LIMA_CALENDAR = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' })

export function limaDate (instant) {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw new DomainError('limaDate espera una fecha válida', { statusCode: 400 })
  }
  return LIMA_CALENDAR.format(instant)
}

function parseYmd (value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? '').trim())
  if (!match) {
    throw new DomainError(`Fecha inválida: ${value} (se espera YYYY-MM-DD)`, { statusCode: 400 })
  }
  const [, year, month, day] = match
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  // Date.UTC normaliza silenciosamente los desbordes (mes 13 -> enero siguiente),
  // así que hay que verificar que la fecha exista de verdad.
  if (date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) {
    throw new DomainError(`Fecha inexistente: ${value}`, { statusCode: 400 })
  }
  return date
}

// Lunes de la semana ISO a la que pertenece una fecha, como 'YYYY-MM-DD'.
// Acepta cualquier día: quien carga a mano elige la fecha que quiera y el
// snapshot aterriza igual en la semana correcta.
export function isoWeekStart (value) {
  const date = parseYmd(value)
  const daysSinceMonday = (date.getUTCDay() + 6) % 7
  return new Date(date.getTime() - daysSinceMonday * MS_PER_DAY).toISOString().slice(0, 10)
}

function weeksBetween (fromWeek, toWeek) {
  return Math.round((parseYmd(toWeek) - parseYmd(fromWeek)) / MS_PER_WEEK)
}

// Convierte snapshots planos en series por cuenta, agregándoles el crecimiento.
//
// Entrada: filas con { account_id, week_start: 'YYYY-MM-DD', followers, ... }.
// Salida: las mismas filas ordenadas por cuenta y semana, más:
//   growth         seguidores ganados desde el snapshot anterior (null en el primero)
//   weeks_spanned  cuántas semanas cubre ese crecimiento (1 = semanas consecutivas)
//
// weeks_spanned > 1 significa que faltan semanas en medio (el cron no corrió, o
// nadie cargó el dato manual). El crecimiento sigue siendo real pero es
// acumulado, y la vista lo marca para que nadie lo lea como semanal.
export function buildGrowthSeries (rows = []) {
  const byAccount = new Map()
  for (const row of rows) {
    if (!byAccount.has(row.account_id)) byAccount.set(row.account_id, [])
    byAccount.get(row.account_id).push(row)
  }

  const series = []
  for (const snapshots of byAccount.values()) {
    snapshots.sort((a, b) => String(a.week_start).localeCompare(String(b.week_start)))
    let previous = null
    for (const snapshot of snapshots) {
      series.push({
        ...snapshot,
        growth: previous ? snapshot.followers - previous.followers : null,
        weeks_spanned: previous ? weeksBetween(previous.week_start, snapshot.week_start) : null
      })
      previous = snapshot
    }
  }
  return series
}

// Ventana de años aceptada. No es una regla de negocio, es una red contra el
// dedo: un "202" o un "20226" tipeado crearía una fila que nadie vuelve a ver
// porque ninguna vista pide ese año.
const FIRST_YEAR = 2020
const LAST_YEAR = 2100

export function validateBrandGoal ({ brand, year, followers_goal: followersGoal } = {}) {
  const cleanBrand = String(brand ?? '').trim()
  if (!cleanBrand) throw new DomainError('brand es obligatorio', { statusCode: 400 })

  const cleanYear = Number(year)
  if (!Number.isInteger(cleanYear) || cleanYear < FIRST_YEAR || cleanYear > LAST_YEAR) {
    throw new DomainError(`year debe ser un año entre ${FIRST_YEAR} y ${LAST_YEAR}`, { statusCode: 400 })
  }

  // Un objetivo de 0 no es "sin objetivo", es una meta imposible de no cumplir y
  // pintaría 100% de avance para siempre. Para sacar la meta se borra la fila.
  const goal = Number(followersGoal)
  if (!Number.isInteger(goal) || goal <= 0) {
    throw new DomainError('followers_goal debe ser un entero mayor a 0', { statusCode: 400 })
  }

  return { brand: cleanBrand, year: cleanYear, followersGoal: goal }
}

function requireAccountId (raw) {
  const accountId = Number(raw)
  if (!Number.isInteger(accountId) || accountId <= 0) {
    throw new DomainError('account_id es obligatorio y debe ser un entero positivo', { statusCode: 400 })
  }
  return accountId
}

// Carga manual: LinkedIn, los grupos de Facebook y las líneas de WhatsApp, que
// no tienen API de la cual leerlos.
export function validateManualSnapshot ({ account_id: accountId, week_start: weekStart, followers } = {}) {
  // El descarte explícito de vacíos va antes que Number(): Number(null) y
  // Number('') son 0, así que un campo sin llenar se guardaría como "0
  // seguidores" y el delta de esa semana sería una caída de miles inventada.
  if (followers === null || followers === undefined || String(followers).trim() === '') {
    throw new DomainError('followers es obligatorio', { statusCode: 400 })
  }
  const count = Number(followers)
  if (!Number.isInteger(count) || count < 0) {
    throw new DomainError('followers debe ser un entero mayor o igual a 0', { statusCode: 400 })
  }
  return {
    accountId: requireAccountId(accountId),
    weekStart: isoWeekStart(weekStart),
    followers: count
  }
}
