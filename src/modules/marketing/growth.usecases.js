import * as repo from './growth.repository.js'
import {
  buildGrowthSeries,
  isoWeekStart,
  limaDate,
  validateBrandGoal,
  validateManualSnapshot
} from './growth.entity.js'

export function listAccounts () {
  return repo.listAccounts()
}

export async function getGrowth ({ from, to, brand = null }) {
  const rows = await repo.listSnapshots({
    // Se normalizan los extremos al lunes de su semana para que un rango elegido
    // a media semana no recorte el snapshot de esa misma semana.
    from: isoWeekStart(from),
    to: isoWeekStart(to),
    brand: brand || null
  })
  return buildGrowthSeries(rows)
}

export function listBrandGoals (year) {
  return repo.listGoals(Number(year))
}

export async function saveBrandGoal (input, updatedBy = null) {
  const { brand, year, followersGoal } = validateBrandGoal(input)
  await repo.upsertGoal({ brand, year, followersGoal, updatedBy })
  return { brand, year, followers_goal: followersGoal }
}

export async function saveManualSnapshot (input, capturedBy = null) {
  const { accountId, weekStart, followers } = validateManualSnapshot(input)
  await repo.upsertSnapshot({
    accountId, weekStart, followers, source: 'MANUAL', capturedBy
  })
  return { account_id: accountId, week_start: weekStart, followers }
}

// Captura de las cuentas que sí tienen API.
//
// Los lectores llegan inyectados (`providers`: red -> función que recibe el
// external_id y devuelve el número de seguidores) y el instante también, así este
// caso de uso no sabe de HTTP ni consulta el reloj: se puede testear entero sin
// red. Una red sin lector simplemente se saltea y se sigue cargando a mano.
export async function captureFollowers ({ providers = {}, now, capturedBy = 'cron' }) {
  const weekStart = isoWeekStart(limaDate(now))
  const accounts = await repo.listAccounts({ automatedOnly: true })

  const result = { week_start: weekStart, guardadas: 0, sin_lector: 0, errores: [] }
  for (const account of accounts) {
    const readFollowers = providers[account.network]
    if (!readFollowers) { result.sin_lector++; continue }
    try {
      const followers = await readFollowers(account.external_id)
      await repo.upsertSnapshot({
        accountId: account.account_id, weekStart, followers, source: 'API', capturedBy
      })
      result.guardadas++
    } catch (err) {
      // Cada cuenta falla por separado: un token vencido de Facebook no debe
      // impedir que se guarde YouTube.
      result.errores.push(`${account.brand}/${account.network}: ${err.message}`)
    }
  }
  return result
}
