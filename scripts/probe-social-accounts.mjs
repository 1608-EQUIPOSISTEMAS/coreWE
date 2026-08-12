// Estado de Crecimiento RRSS: que cuentas hay, cual fue su ultima medicion y
// cuales quedaron sin dato de la semana en curso.
//
//   node scripts/probe-social-accounts.mjs
//
// Solo lee. Las cuentas atrasadas son la unica senal que tenemos de un token
// vencido: no hay alerta de expiracion en ningun lado.
import { q, pool } from './db.mjs'

const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())
const { rows: [{ semana }] } = await q(`SELECT to_char(date_trunc('week', $1::date), 'YYYY-MM-DD') AS semana`, [hoy])

const { rows } = await q(`
  SELECT a.brand, a.network, a.display_name,
         a.external_id IS NOT NULL AS con_api,
         to_char(max(s.week_start), 'YYYY-MM-DD') AS ultima,
         max(s.followers) FILTER (WHERE s.week_start = (
           SELECT max(week_start) FROM social_follower_snapshots WHERE account_id = a.account_id
         )) AS seguidores
  FROM social_accounts a
  LEFT JOIN social_follower_snapshots s USING (account_id)
  WHERE a.active = 'Y'
  GROUP BY a.account_id, a.brand, a.network, a.display_name, a.external_id
  ORDER BY a.brand, a.network, a.display_name
`)

console.log(`Semana en curso: ${semana}\n`)
let marcaActual = null
for (const r of rows) {
  if (r.brand !== marcaActual) { console.log(`\n== ${r.brand}`); marcaActual = r.brand }
  const estado = r.ultima === semana ? 'al dia' : (r.ultima ? `ATRASADA (${r.ultima})` : 'SIN DATOS')
  const modo = r.con_api ? 'api   ' : 'manual'
  console.log(`  ${modo} ${r.network.padEnd(15)} ${String(r.display_name).slice(0, 44).padEnd(45)} ` +
              `${String(r.seguidores ?? '-').padStart(9)}  ${estado}`)
}

const atrasadas = rows.filter(r => r.ultima !== semana).length
console.log(`\n${rows.length} cuentas activas, ${rows.filter(r => r.con_api).length} con API, ${atrasadas} sin dato de esta semana.`)
await pool.end()
