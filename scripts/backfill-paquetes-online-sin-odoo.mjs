// Backfill: ventas de paquetes online que quedaron sin NADIE en Odoo por el
// viejo skip `e0_parent` de enrollInOdoo, y que ya recibieron el correo con
// credenciales sintetizadas.
//
// Requiere el fix de enrollInOdoo (enrollPackageModules): al llamarlo sobre el
// padre, inscribe sus modulos y le hereda la identidad Odoo. NO reenvia correos:
// el login y la contraseña que el alumno ya recibio son exactamente los que se
// generan aca, asi que al crear la cuenta las credenciales enviadas funcionan.
//
//   node scripts/backfill-paquetes-online-sin-odoo.mjs            # solo lista
//   node scripts/backfill-paquetes-online-sin-odoo.mjs --aplicar  # ejecuta
import './_prod.mjs'
import { pool } from '../src/config/db.js'
import { enrollInOdoo } from '../src/modules/fico/odoo-sync/odoo-sync.usecases.js'

const APLICAR = process.argv.includes('--aplicar')
const PAQUETES = [18632, 18583, 17856, 16556]

async function estado (enrollmentId) {
  const { rows } = await pool.query(`
    SELECT e.enrollment_id, e.odoo_user_id, e.odoo_email,
           pv.abbreviation AS programa,
           (SELECT COUNT(*) FROM enrollments h
             WHERE h.parent_enrollment_id = e.enrollment_id AND h.active = 'Y')::int AS modulos,
           (SELECT COUNT(*) FROM enrollments h
             WHERE h.parent_enrollment_id = e.enrollment_id AND h.active = 'Y'
               AND h.odoo_user_id IS NOT NULL)::int AS modulos_en_odoo
      FROM enrollments e
      LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
     WHERE e.enrollment_id = $1`, [enrollmentId])
  return rows[0]
}

console.log(APLICAR ? '>>> APLICANDO EN PRODUCCION\n' : '>>> Solo lectura (agrega --aplicar para ejecutar)\n')

console.log('=== ANTES ===')
console.table(await Promise.all(PAQUETES.map(estado)))

if (APLICAR) {
  for (const enrollmentId of PAQUETES) {
    // Cada paquete en su propia iteracion: si Odoo falla en uno, los demas
    // igual se procesan y el detalle queda impreso para reintentar solo ese.
    try {
      const res = await enrollInOdoo({ enrollmentId })
      console.log(`#${enrollmentId}:`, res.success ? `OK user ${res.odoo_user_id} (${res.odoo_email})` : `FALLO — ${res.error}`)
    } catch (err) {
      console.error(`#${enrollmentId}: EXCEPCION —`, err.message)
    }
  }

  console.log('\n=== DESPUES ===')
  console.table(await Promise.all(PAQUETES.map(estado)))
}

await pool.end()
