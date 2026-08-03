// One-off 2026-08-03: alta del descuento "60% - MEMBRESIA" en el combo DESCUENTO (%).
// El combo (sp_discount_caller) arma el label como value% - description, tipo 2493.
// Idempotente: ON CONFLICT por alias no existe, así que se guarda con NOT EXISTS.
import { q, pool } from './db.mjs'

const { rows } = await q(`
  INSERT INTO discounts (description, alias, cat_discount_type, value, is_global,
                         active, cat_currency_type, start_date)
  SELECT 'MEMBRESIA', '60_membresia', 2493, 60.00, true, true, 3041, current_date
  WHERE NOT EXISTS (SELECT 1 FROM discounts WHERE alias = '60_membresia')
  RETURNING discount_id, description, alias, value
`)
console.log(rows.length ? rows[0] : 'ya existía, nada que hacer')

const combo = await q(`
  SELECT d.value::float || '% - ' || d.description AS full_label
  FROM discounts d WHERE d.cat_discount_type = 2493 AND d.active
    AND (d.start_date IS NULL OR d.start_date <= current_date)
    AND (d.end_date IS NULL OR d.end_date >= current_date)
  ORDER BY d.description ASC LIMIT 20
`)
console.log(combo.rows.map(r => r.full_label))
await pool.end()
