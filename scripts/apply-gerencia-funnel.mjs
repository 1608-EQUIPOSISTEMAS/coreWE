// Aplica gerencia-funnel.sql y verifica contra mayo-2026.
import { readFileSync } from 'node:fs'
import { q, pool } from './db.mjs'
try {
  await q(readFileSync(new URL('./gerencia-funnel.sql', import.meta.url), 'utf8'))
  console.log('OK: migracion + vista aplicadas')
  const { rows } = await q(`
    SELECT COUNT(*)::int AS ediciones,
           SUM(consultas)::int AS consultas,
           SUM(ventas)::int    AS ventas,
           SUM(ventas_trazadas)::int AS trazadas
    FROM v_gerencia_funnel WHERE anio = 2026 AND mes_num = 5`)
  console.log('mayo-2026:', rows[0])
  const m = await q(`
    SELECT codigo_edicion, programa, consultas, ventas, canales
    FROM v_gerencia_funnel WHERE anio = 2026 AND mes_num = 5 AND ventas > 0
    ORDER BY ventas DESC LIMIT 2`)
  console.log(JSON.stringify(m.rows, null, 1))
} catch (e) { console.error('FALLO:', e.message) } finally { await pool.end() }
