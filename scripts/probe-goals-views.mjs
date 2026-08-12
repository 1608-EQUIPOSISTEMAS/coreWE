// ¿Alguna vista/consumidor asume lead_goal o channel_goals NOT NULL?
// Se corre antes de devolverlos a nullable (que es como los diseñó gerencia-funnel.sql).
import { q, pool } from './db.mjs'

const vistas = await q(`
  SELECT c.relname AS vista, pg_get_viewdef(c.oid) AS def
  FROM pg_class c
  WHERE c.relkind IN ('v','m') AND pg_get_viewdef(c.oid) ILIKE '%program_edition_goals%'`)

for (const v of vistas.rows) {
  const lineas = v.def.split('\n').filter(l => /lead_goal|channel_goals/i.test(l))
  console.log(`\n── ${v.vista} ──`)
  console.log(lineas.join('\n') || '(no menciona lead_goal / channel_goals)')
}

const nulos = await q(`
  SELECT count(*) FILTER (WHERE lead_goal = 0) AS lead_cero,
         count(*) FILTER (WHERE channel_goals = '{}'::jsonb) AS canal_vacio,
         count(*) AS total
  FROM public.program_edition_goals`)
console.log('\nfilas:', nulos.rows[0])
await pool.end()
