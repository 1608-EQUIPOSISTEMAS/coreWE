// Comprobacion del arreglo del apellido materno duplicado (ver
// arreglar-apellido-materno-duplicado.mjs). Nombre como lo ve el panel de FICO.
import { q, pool } from './db.mjs'
const { rows } = await q(`
  SELECT e.enrollment_id, p.first_name, p.last_name, p.mother_last_name,
         TRIM(concat_ws(' ', p.first_name, p.last_name, p.mother_last_name)) AS como_se_ve
    FROM enrollments e
    JOIN customers c ON c.customer_id = e.customer_id
    JOIN persons p ON p.person_id = c.person_id
   WHERE e.enrollment_id = 13841`)
console.log(rows)
await pool.end()
