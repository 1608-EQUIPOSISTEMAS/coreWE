// Devuelve lead_goal y channel_goals a nullable en program_edition_goals.
//
// Por qué: el upsert de metas (dashboard.repository.js) manda NULL en esas dos
// columnas cuando el que guarda es Producto->Cronograma, que no las conoce. NULL
// = "no me lo mandaron" y el COALESCE del DO UPDATE conserva lo que cargó
// Gerencia. Con NOT NULL, Postgres rechaza la tupla antes de resolver el
// conflicto (23502) y el guardado de objetivos falla siempre.
// El DEFAULT se queda: sirve para los INSERT que sí omiten la columna.
// Único consumidor: v_gerencia_funnel, que ya hace COALESCE de ambas.
import { q, pool } from './db.mjs'

await q(`ALTER TABLE public.program_edition_goals
           ALTER COLUMN lead_goal     DROP NOT NULL,
           ALTER COLUMN channel_goals DROP NOT NULL`)

const { rows } = await q(`
  SELECT column_name, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='program_edition_goals'
    AND column_name IN ('lead_goal','channel_goals')`)
console.table(rows)
await pool.end()
