// One-off 2026-08-05: las ventas del V CONGRESO DE DIRECCIÓN quedaron con
// agent_origin='WE' porque el form ignoraba el area WE elegida (TWE/FWE).
// Solo estas dos son de Fundacion; el resto de las 94 'WE' son cursos de Talento.
import { q, pool } from './db.mjs'

const IDS = [15805, 15807]

const { rows: antes } = await q(
  'SELECT enrollment_id, agent_origin FROM enrollments WHERE enrollment_id = ANY($1)', [IDS])
console.table(antes)

const { rows: after } = await q(`
  UPDATE enrollments SET agent_origin = 'FWE', modification_date = NOW()
   WHERE enrollment_id = ANY($1) AND agent_origin = 'WE'
  RETURNING enrollment_id, agent_origin`, [IDS])
console.log('Actualizados:', after)

await q('REFRESH MATERIALIZED VIEW mv_enrollment_report_system').catch(e =>
  console.warn('matview no refrescada:', e.message))

await pool.end()
