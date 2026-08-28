// Comprueba EXCLUDE_UNCOLLECTED_SERVICE_ORDER contra un motor Postgres de verdad:
// toma una venta que hoy entra al sync, la disfraza de Orden de Servicio sin
// cobrar y verifica que el predicado la deje fuera. Todo dentro de una
// transaccion que SIEMPRE se revierte, asi que no altera ningun dato.
//
// Un test de string no sirve para esto: el SQL puede ser sintacticamente valido
// y aun asi no filtrar nada.
//
// Uso:  node scripts/verificar-regla-os.mjs      (por defecto contra la BD local)
import { q, pool } from './db.mjs'
import { EXCLUDE_UNCOLLECTED_SERVICE_ORDER } from '../src/modules/integration/integration.repository.js'

const pasaElFiltro = async (id) => {
  const { rows } = await q(
    `SELECT 1 FROM public.enrollments e
      WHERE e.enrollment_id = $1 ${EXCLUDE_UNCOLLECTED_SERVICE_ORDER}`, [id])
  return rows.length > 0
}

const db = (await q('SELECT current_database() AS db')).rows[0].db
console.log('BD:', db)

// Cualquier venta con monto y con pago activo sirve de cobaya.
const { rows: [cobaya] } = await q(`
  SELECT e.enrollment_id FROM public.enrollments e
   WHERE e.total_amount > 0 AND e.active = 'Y'
     AND EXISTS (SELECT 1 FROM public.payments py
                  WHERE py.enrollment_id = e.enrollment_id AND py.active = 'Y')
   ORDER BY e.enrollment_id DESC LIMIT 1`)
if (!cobaya) throw new Error('No hay ninguna venta con pago activo para la prueba')
const id = cobaya.enrollment_id

const resultados = []
await q('BEGIN')
try {
  resultados.push(['venta normal con pago', await pasaElFiltro(id), true])

  await q(`UPDATE enrollments
              SET cat_b2b_doctype = (SELECT catalog_id FROM catalog
                                      WHERE alias = 'we_enrollment_b2b_doctype_service_order')
            WHERE enrollment_id = $1`, [id])
  resultados.push(['OS con el cobro ya registrado', await pasaElFiltro(id), true])

  await q(`UPDATE payments SET active = 'N' WHERE enrollment_id = $1`, [id])
  resultados.push(['OS sin cobro registrado', await pasaElFiltro(id), false])

  await q('UPDATE enrollments SET total_amount = 0 WHERE enrollment_id = $1', [id])
  resultados.push(['venta documental de total 0', await pasaElFiltro(id), true])
} finally {
  await q('ROLLBACK')
}

console.log(`cobaya: enrollment ${id} (revertido)\n`)
console.table(resultados.map(([caso, entra, esperado]) => ({
  caso, entra_al_sync: entra, esperado, ok: entra === esperado ? 'OK' : 'FALLA'
})))
const fallas = resultados.filter(([, entra, esperado]) => entra !== esperado)
await pool.end()
if (fallas.length) process.exit(1)
