import { pool } from '../../config/db.js'

// Cuentas cuyo crecimiento medimos.
// automatedOnly = solo las que tienen external_id, es decir las que un lector de
// API puede resolver; el resto (LinkedIn, grupos de FB, WhatsApp) se carga a mano.
export async function listAccounts ({ automatedOnly = false } = {}) {
  const { rows } = await pool.query(`
    SELECT account_id, brand, network, display_name, external_id
    FROM social_accounts
    WHERE active = 'Y'
      AND ($1 = false OR external_id IS NOT NULL)
    ORDER BY brand, network, display_name
  `, [automatedOnly])
  return rows
}

// Snapshots del rango, sin calcular nada: el crecimiento lo deriva
// buildGrowthSeries (growth.entity.js), que es donde vive la regla y se testea.
//
// week_start sale por to_char y no crudo porque node-postgres mapea DATE a un
// objeto Date de JS, y la entidad ordena y resta semanas comparando strings.
export async function listSnapshots ({ from, to, brand = null }) {
  const { rows } = await pool.query(`
    SELECT s.account_id, a.brand, a.network, a.display_name,
           to_char(s.week_start, 'YYYY-MM-DD') AS week_start,
           s.followers, s.source, s.captured_at
    FROM social_follower_snapshots s
    JOIN social_accounts a USING (account_id)
    WHERE a.active = 'Y'
      AND s.week_start BETWEEN $1::date AND $2::date
      AND ($3::text IS NULL OR a.brand = $3)
    ORDER BY a.brand, a.network, a.display_name, s.week_start
  `, [from, to, brand])
  return rows
}

// Idempotente por la PK (account_id, week_start): el cron corre a diario sobre la
// semana en curso y cada corrida pisa la anterior, de modo que el valor converge
// al del cierre de semana. Gana la última escritura, venga de la API o de una
// carga manual.
export async function upsertSnapshot ({ accountId, weekStart, followers, source, capturedBy = null }) {
  await pool.query(`
    INSERT INTO social_follower_snapshots
      (account_id, week_start, followers, source, captured_by)
    VALUES ($1, $2::date, $3, $4, $5)
    ON CONFLICT (account_id, week_start) DO UPDATE
      SET followers = EXCLUDED.followers,
          source = EXCLUDED.source,
          captured_at = now(),
          captured_by = EXCLUDED.captured_by
  `, [accountId, weekStart, followers, source, capturedBy])
}
