// Deja PRODUCCION lista para ver Producto > Planificacion:
//
//   1. crea la tabla schedule_plans (misma DDL que ddl-schedule-plans.mjs),
//   2. crea el escenario del anio si no existe,
//   3. lo siembra copiando el anio anterior con el mismo dia de la semana.
//
// El plan NO se copia desde la BD local a proposito: los items son un snapshot
// de las ediciones reales, y sembrarlo contra produccion garantiza que apunte a
// las ediciones que produccion tiene HOY y no a las del clon.
//
// Idempotente y sin DELETE: re-sembrar respeta lo ya publicado.
//
//   DATABASE_URL='postgresql://postgres:***@127.0.0.1:55432/neondb' \
//     node scripts/cargar-planificacion-produccion.mjs
import 'dotenv/config'
import { q, pool } from './db.mjs'
import * as planes from '../src/modules/scheduleplan/scheduleplan.usecases.js'

const ANIO_ORIGEN = 2026
const ANIO_PLAN = 2027
const NOMBRE = `Programacion ${ANIO_PLAN}`
const USER_ID = 9 // ADMIN

// Guarda: el .env apunta a la BD de pruebas, asi que sin DATABASE_URL explicita
// este script sembraria el clon local creyendo que toca produccion.
const destino = process.env.DATABASE_URL || ''
if (!destino.includes('55432') || !destino.includes('neondb')) {
  throw new Error(`Esto es solo para produccion (tunel 55432/neondb). DATABASE_URL apunta a: ${destino}`)
}

await q(`
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
`)
console.log('tabla schedule_plans lista')

const { rows: [existente] } = await q(
  "SELECT plan_id FROM schedule_plans WHERE name = $1 AND active = 'Y'", [NOMBRE])
const plan = existente || await planes.createPlan({ name: NOMBRE, year: ANIO_PLAN, user_id: USER_ID })
console.log(existente ? `escenario "${NOMBRE}" ya existia (plan_id ${plan.plan_id})` : `escenario "${NOMBRE}" creado (plan_id ${plan.plan_id})`)

console.log(`sembrando desde ${ANIO_ORIGEN}...`)
const res = await planes.seedYearFromYear({
  plan_id: plan.plan_id, source_year: ANIO_ORIGEN, mode: 'weekday', user_id: USER_ID
})
console.log(res)

const { rows: porMes } = await q(`
  SELECT to_char((i->>'start_date')::date, 'YYYY-MM') AS mes, count(*)::int AS ediciones
  FROM schedule_plans, jsonb_array_elements(items) i
  WHERE plan_id = $1 AND i->>'start_date' IS NOT NULL
  GROUP BY 1 ORDER BY 1`, [plan.plan_id])
console.table(porMes)

await pool.end()
