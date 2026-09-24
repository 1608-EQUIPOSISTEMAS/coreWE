import { pool } from '../../../shared/db/pool.js'

// Los meses de campaña. Va escrito aquí y en scripts/lib/clasificacion-ediciones.mjs
// porque la elección de temporada tiene que resolverse DENTRO del UPDATE que
// aplica el estándar: traérselo a JS obligaría a leer y reescribir edición por
// edición para no ganar nada.
const MESES_ALTOS = '(1, 2, 3, 7)'
const TEMPORADA_DE_LA_EDICION =
  `CASE WHEN EXTRACT(month FROM pe.start_date) IN ${MESES_ALTOS} THEN 'ALTA' ELSE 'NORMAL' END`

// El OBJ de una edición es la SUMA de sus canales y nunca una cifra aparte: en el
// plan las dos se declaraban por separado y llegaron a contradecirse.
const sumaDeCanales = (metrica, columna) =>
  `COALESCE((SELECT SUM((c.v ->> '${metrica}')::int) FROM jsonb_each(${columna}) AS c(k, v)), 0)`

export const goalStandardsRepository = {
  db: pool,

  // Un programa por fila, con su estándar de esa temporada. Se listan las
  // versiones que tienen estándar cargado O ediciones por venir: el catálogo
  // arrastra versiones muertas que nadie va a programar nunca más.
  async list ({ season }) {
    const sql = `
      SELECT pv.program_version_id, pv.abbreviation AS programa, p.program_name,
             cat.description AS linea,
             s.season, s.side, COALESCE(s.channel_goals, '{}'::jsonb) AS channel_goals,
             s.modification_date, COALESCE(u.alias, u.name) AS autor,
             ed.futuras::int AS ediciones_futuras
        FROM public.program_versions pv
        JOIN public.programs p ON p.program_id = pv.program_id
        LEFT JOIN public.catalog cat ON cat.catalog_id = p.cat_category
        LEFT JOIN public.program_goal_standards s
               ON s.program_version_id = pv.program_version_id AND s.season = $1
        LEFT JOIN public.users u ON u.user_id = COALESCE(s.user_modification_id, s.user_registration_id)
        CROSS JOIN LATERAL (
          SELECT count(*) AS futuras FROM public.program_editions pe
           WHERE pe.program_version_id = pv.program_version_id
             AND pe.active IN ('Y', '1') AND pe.start_date >= CURRENT_DATE
        ) ed
       WHERE pv.active IN ('Y', '1')
         AND (s.season IS NOT NULL OR ed.futuras > 0)
       ORDER BY pv.abbreviation`
    const { rows } = await this.db.query(sql, [season])
    return rows
  },

  async save ({ standards, season, userId }) {
    const sql = `
      INSERT INTO public.program_goal_standards
        (program_version_id, season, side, channel_goals, user_registration_id)
      SELECT *, $5 FROM unnest($1::int[], $2::text[], $3::text[], $4::jsonb[])
      ON CONFLICT (program_version_id, season) DO UPDATE SET
        side = EXCLUDED.side,
        channel_goals = EXCLUDED.channel_goals,
        user_modification_id = EXCLUDED.user_registration_id,
        modification_date = now()`
    const { rowCount } = await this.db.query(sql, [
      standards.map((s) => s.program_version_id),
      standards.map(() => season),
      standards.map((s) => s.side),
      standards.map((s) => JSON.stringify(s.channel_goals ?? {})),
      userId
    ])
    return { saved: rowCount }
  },

  // Baja el estándar a las ediciones. Dos guardas, y las dos son la regla de
  // negocio, no una optimización:
  //   · start_date >= CURRENT_DATE — cambiar el estándar no reescribe el objetivo
  //     de lo que ya empezó o está en venta; hacia atrás no se toca.
  //   · goal_source <> 'GERENCIA' — lo que alguien ajustó a mano manda sobre el
  //     estándar, igual que cuando el plan vivía en el Sheet.
  // versionIds en null = todas: es el "recalcular" que alcanza a las ediciones
  // creadas después del último cambio de parámetros.
  async apply ({ versionIds = null, userId }) {
    const sql = `
      WITH objetivo AS (
        SELECT pe.edition_num_id, s.channel_goals,
               ${sumaDeCanales('ventas', 's.channel_goals')} AS ventas,
               ${sumaDeCanales('consultas', 's.channel_goals')} AS consultas
          FROM public.program_editions pe
          JOIN public.program_goal_standards s
            ON s.program_version_id = pe.program_version_id
           AND s.season = ${TEMPORADA_DE_LA_EDICION}
         WHERE pe.active IN ('Y', '1')
           AND pe.start_date >= CURRENT_DATE
           AND ($1::int[] IS NULL OR pe.program_version_id = ANY($1::int[]))
      )
      INSERT INTO public.program_edition_goals
        (edition_num_id, vacant_goal, lead_goal, channel_goals, goal_source, user_registration_id)
      SELECT edition_num_id, ventas, consultas, channel_goals, 'PLAN', $2 FROM objetivo
      -- revenue_goal no se toca: el objetivo de ingresos no sale del estándar.
      ON CONFLICT (edition_num_id) DO UPDATE SET
        vacant_goal = EXCLUDED.vacant_goal,
        lead_goal = EXCLUDED.lead_goal,
        channel_goals = EXCLUDED.channel_goals,
        goal_source = 'PLAN',
        user_modification_id = EXCLUDED.user_registration_id,
        modification_date = now()
      WHERE program_edition_goals.goal_source <> 'GERENCIA'`
    const { rowCount } = await this.db.query(sql, [versionIds, userId])
    return { applied: rowCount }
  }
}
