// DDL del modulo Planificacion (Producto > Planificacion).
//
// Una fila por escenario de programacion ("plan 2027 conservador", "plan 2027
// agresivo"...). Los items viven en un JSONB y NO en program_editions a
// proposito: un borrador que compartiera tabla con las ediciones reales se
// filtraria a ventas, aula, matviews y contadores el dia que alguien navegue al
// anio planificado. Aca es fisicamente imposible.
//
// Cada item del JSONB es la fila de sp_edition_tree_get (la misma forma que
// edita el modal real), de modo que publicar = reproducir ese payload contra
// sp_edition_register / sp_edition_tree_register sin traducir nada.
//
// Idempotente: se puede correr las veces que haga falta.
//   node scripts/ddl-schedule-plans.mjs
import { q, pool } from './db.mjs'

const DDL = `
CREATE TABLE IF NOT EXISTS schedule_plans (
  plan_id              serial PRIMARY KEY,
  name                 text      NOT NULL,
  year                 integer   NOT NULL,
  items                jsonb     NOT NULL DEFAULT '[]'::jsonb,
  active               char(1)   NOT NULL DEFAULT 'Y',
  user_registration_id integer,
  user_modification_id integer,
  registration_date    timestamp NOT NULL DEFAULT now(),
  modification_date    timestamp
);

CREATE INDEX IF NOT EXISTS ix_schedule_plans_year ON schedule_plans (year) WHERE active = 'Y';
`

await q(DDL)

const { rows } = await q(`
  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_name = 'schedule_plans'
  ORDER BY ordinal_position`)

console.log('schedule_plans:')
console.table(rows)

await pool.end()
