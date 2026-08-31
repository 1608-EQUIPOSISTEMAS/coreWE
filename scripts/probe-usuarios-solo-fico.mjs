// Usuarios cuyo unico rol es FICO/LIDER_FICO: registran ventas y generan links,
// pero no venden. Su codigo no debe figurar como ASESOR en las hojas del sync.
//   node scripts/probe-usuarios-solo-fico.mjs [--prod]
import fs from 'fs'
if (process.argv.includes('--prod')) {
  process.env.DATABASE_URL = fs.readFileSync('.env.bak-produccion', 'utf8').match(/postgresql:\/\/\S+/)[0]
}
const { pool } = await import('./db.mjs')

const soloFico = `
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = u.user_id)
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
      JOIN public.rol r ON r.rol_id = ur.rol_id
     WHERE ur.user_id = u.user_id AND r.alias NOT IN ('FICO','LIDER_FICO'))`

console.log('-- usuarios que la regla silenciaria --')
console.table((await pool.query(`
  SELECT u.alias, u.name,
         (SELECT string_agg(r.alias, ', ') FROM public.user_roles ur
            JOIN public.rol r ON r.rol_id = ur.rol_id WHERE ur.user_id = u.user_id) AS roles
    FROM public.users u WHERE ${soloFico} ORDER BY u.alias`)).rows)

console.log('-- usuarios SIN ningun rol (la regla NO los toca, conservan su alias) --')
console.table((await pool.query(`
  SELECT u.alias, u.name, u.active FROM public.users u
   WHERE NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = u.user_id)
     AND EXISTS (SELECT 1 FROM public.enrollments e WHERE e.seller_agent_id = u.user_id)
   ORDER BY u.alias`)).rows)
await pool.end()
