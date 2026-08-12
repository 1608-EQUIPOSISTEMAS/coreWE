// Sondeo: por qué falla el guardado de "Objetivos Mensuales" (dashboard/program-goals/save).
// Reproduce el upsert exacto del repository con un usuario real y sin lead_goal/
// channel_goals (que es como lo manda Producto->Cronograma). Todo en rollback.
import { q, pool } from './db.mjs'

const UPSERT = `
  INSERT INTO public.program_edition_goals
    (edition_num_id, vacant_goal, revenue_goal, lead_goal, channel_goals, user_registration_id)
  SELECT * FROM unnest($1::int[], $2::int[], $3::numeric[], $4::int[], $5::jsonb[], $6::int[])
  ON CONFLICT (edition_num_id) DO UPDATE SET
    vacant_goal = EXCLUDED.vacant_goal,
    revenue_goal = EXCLUDED.revenue_goal,
    lead_goal = COALESCE(EXCLUDED.lead_goal, program_edition_goals.lead_goal),
    channel_goals = COALESCE(EXCLUDED.channel_goals, program_edition_goals.channel_goals),
    user_modification_id = EXCLUDED.user_registration_id,
    modification_date = now()
`

const uid = (await q(`SELECT user_id FROM public.users ORDER BY user_id LIMIT 1`)).rows[0].user_id
const nueva = (await q(`
  SELECT pe.edition_num_id FROM public.program_editions pe
  LEFT JOIN public.program_edition_goals g ON g.edition_num_id = pe.edition_num_id
  WHERE g.goal_id IS NULL ORDER BY pe.edition_num_id DESC LIMIT 1`)).rows[0]?.edition_num_id
const existente = (await q(`SELECT edition_num_id FROM public.program_edition_goals LIMIT 1`)).rows[0]?.edition_num_id

async function probar (etiqueta, id) {
  if (!id) return console.log(etiqueta, '-> sin edicion de prueba')
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    const r = await c.query(UPSERT, [[id], [5], [0], [null], [null], [uid]])
    console.log(etiqueta, `(ed ${id}) -> OK, filas:`, r.rowCount)
  } catch (e) {
    console.log(etiqueta, `(ed ${id}) -> FALLA ${e.code}: ${e.message}`)
  } finally {
    await c.query('ROLLBACK').catch(() => {})
    c.release()
  }
}

console.log('user_id de prueba:', uid)
await probar('INSERT (edicion sin meta previa)', nueva)
await probar('UPDATE (edicion con meta previa)', existente)
await pool.end()
