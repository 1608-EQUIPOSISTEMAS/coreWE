// Verifica que reprogram_cases tenga la columna proposed_source (origen del
// destino: producto = lo dejo Producto al cancelar la edicion; academica = lo
// confirmo o lo cambio Academica tras hablar con el alumno).
import { pool } from './db.mjs'

const { rows: [db] } = await pool.query('SELECT current_database() AS db, inet_server_port() AS puerto')
const { rows: [col] } = await pool.query(`
  SELECT column_name, data_type, character_maximum_length AS largo
    FROM information_schema.columns
   WHERE table_name = 'reprogram_cases' AND column_name = 'proposed_source'`)
const { rows: [chk] } = await pool.query(`
  SELECT pg_get_constraintdef(oid) AS def
    FROM pg_constraint WHERE conname = 'reprogram_cases_source_chk'`)
const { rows: [uso] } = await pool.query(`
  SELECT COUNT(*) FILTER (WHERE proposed_source = 'producto')  AS de_producto,
         COUNT(*) FILTER (WHERE proposed_source = 'academica') AS de_academica,
         COUNT(*) FILTER (WHERE proposed_source IS NULL)       AS sin_origen
    FROM public.reprogram_cases WHERE active = 'Y'`)

console.log({ ...db, columna: col || 'FALTA', check: chk?.def || 'FALTA', uso })
await pool.end()
