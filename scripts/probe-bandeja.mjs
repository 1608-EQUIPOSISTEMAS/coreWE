// Verifica que la bandeja de Reprogramaciones ya no liste ventas resueltas.
import { pool } from './db.mjs'
import { ReprogramacionRepository } from '../src/modules/reprogramacion/reprogramacion.repository.js'
const rows = await new ReprogramacionRepository(pool).listAffected()
console.log('ventas en bandeja:', rows.length)
console.log('12706 presente:', rows.some(r => r.enrollment_id === 12706))
await pool.end()
