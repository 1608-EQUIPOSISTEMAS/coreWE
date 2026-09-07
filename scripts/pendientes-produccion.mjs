// Inventario de lo que falta pasar a PRODUCCION, verificado contra la BD real
// en vez de contra las notas: cada chequeo dice si el cambio ya esta aplicado.
//
// Solo lee. No aplica nada.
import { q, pool } from './prod-db.mjs'

const chequeos = [
  {
    nombre: 'SP sp_fico_enrollment_list — asesor heredado del padre',
    tipo: 'BD',
    sql: `SELECT COUNT(*)::int AS n FROM pg_proc p
           WHERE p.proname = 'sp_fico_enrollment_list'
             AND pg_get_functiondef(p.oid) ILIKE '%uventa%'`,
    aplicado: r => r.n > 0,
    detalle: 'scripts/sp_fico_enrollment_list.sql (probado en local)'
  },
  {
    nombre: 'Backfill modalidad de hijos (Cambiar Modalidad no cascadeaba)',
    tipo: 'datos',
    sql: `SELECT COUNT(*)::int AS n
            FROM enrollments h
            JOIN enrollments p ON p.enrollment_id = h.parent_enrollment_id
           WHERE h.active = 'Y' AND p.active = 'Y'
             AND h.cat_inscription_modality IS DISTINCT FROM p.cat_inscription_modality`,
    aplicado: r => r.n === 0,
    detalle: 'scripts/backfill-modalidad-hijos.mjs --aplicar'
  },
  {
    nombre: 'Padres E0 de paquete sin hijos SEG (fuera de toda aula)',
    tipo: 'datos',
    sql: `SELECT COUNT(*)::int AS n
            FROM enrollments e
            JOIN program_versions pv ON pv.program_version_id = e.program_version_id
           WHERE e.active = 'Y' AND e.program_edition_id IS NULL
             AND EXISTS (SELECT 1 FROM program_version_structure s
                          WHERE s.parent_program_version_id = pv.program_version_id)
             AND NOT EXISTS (SELECT 1 FROM enrollments h
                              WHERE h.parent_enrollment_id = e.enrollment_id AND h.active = 'Y')`,
    aplicado: r => r.n === 0,
    detalle: 'receta en memoria padres-e0-sin-hijos-seg (fix-9940 / fix-18197)'
  },
  {
    nombre: 'Categoria de entrada PONENTE para eventos',
    tipo: 'BD',
    sql: `SELECT COUNT(*)::int AS n FROM catalog WHERE UPPER(description) = 'PONENTE'`,
    aplicado: r => r.n > 0,
    detalle: 'SQL de add-event-category-ponente.sql'
  },
  {
    nombre: 'Modulos RRSS dados de baja (grupo Marketing eliminado)',
    tipo: 'BD',
    sql: `SELECT COUNT(*)::int AS n FROM modules WHERE code IN ('RRSS','MARKETING') AND active = 'Y'`,
    aplicado: r => r.n === 0,
    detalle: 'DROP pendiente segun memoria modulos-rrss-eliminados'
  },
  {
    nombre: 'Rol LIDER_B2B creado',
    tipo: 'BD',
    sql: `SELECT COUNT(*)::int AS n FROM rol WHERE alias = 'LIDER_B2B'`,
    aplicado: r => r.n > 0,
    detalle: 'ya se creo el 28/08; el frontend es lo que faltaba'
  },
  {
    // OJO: NO contar "hijos con edicion NULL" — en un producto Online eso es lo
    // correcto (no existen program_editions). El pendiente real es el contrario:
    // paquetes online VENDIDOS a los que nunca se les creo el hijo.
    nombre: 'Paquetes ONLINE vendidos sin hijos creados',
    tipo: 'datos',
    sql: `SELECT COUNT(*)::int AS n
            FROM enrollments e
            JOIN program_versions pv ON pv.program_version_id = e.program_version_id
            JOIN programs pr ON pr.program_id = pv.program_id AND pr.is_membership = false
            JOIN catalog cm ON cm.catalog_id = pr.cat_model_modality AND cm.description = 'Online'
            JOIN catalog cf ON cf.catalog_id = e.cat_fico_status AND cf.alias = 'we_enrollment_status_checked'
           WHERE e.active = 'Y'
             AND EXISTS (SELECT 1 FROM program_version_structure s
                          WHERE s.parent_program_version_id = pv.program_version_id)
             AND NOT EXISTS (SELECT 1 FROM enrollments h
                              WHERE h.parent_enrollment_id = e.enrollment_id AND h.active = 'Y')`,
    aplicado: r => r.n === 0,
    detalle: 'memoria productos-online-sin-edicion — createChildEnrollments, sin cohorte que decidir'
  },
  {
    nombre: 'Cuotas de importe 0 pendientes (ensucian cobranza)',
    tipo: 'datos',
    sql: `SELECT COUNT(*)::int AS n
            FROM payment_installments pi
            JOIN catalog cs ON cs.catalog_id = pi.cat_status
            JOIN enrollments e ON e.enrollment_id = pi.enrollment_id AND e.active = 'Y'
           WHERE pi.amount = 0 AND cs.alias NOT IN ('we_inst_paid','we_payment_status_paid')`,
    aplicado: r => r.n === 0,
    detalle: 'hallazgo 3 de esta sesion — decision pendiente'
  },
  {
    nombre: 'Ventas cuyas cuotas no cuadran con ningun precio',
    tipo: 'datos',
    sql: `SELECT COUNT(*)::int AS n FROM enrollments e
           WHERE e.active='Y' AND e.parent_enrollment_id IS NULL
             AND e.list_price - e.discount_amount <> e.total_amount
             AND (SELECT COUNT(*) FROM payment_installments pi WHERE pi.enrollment_id = e.enrollment_id) > 0
             AND (SELECT SUM(pi.amount) FROM payment_installments pi WHERE pi.enrollment_id = e.enrollment_id)
                 NOT IN (e.total_amount, e.list_price - e.discount_amount)`,
    aplicado: r => r.n === 0,
    detalle: 'hallazgo 3 — 9 casos con dinero de por medio'
  }
]

const filas = []
for (const c of chequeos) {
  const { rows } = await q(c.sql)
  const ok = c.aplicado(rows[0])
  filas.push({
    tipo: c.tipo,
    estado: ok ? 'ya aplicado' : `PENDIENTE (${rows[0].n})`,
    que: c.nombre,
    como: ok ? '' : c.detalle
  })
}

console.table(filas)
console.log('\nPendientes:', filas.filter(f => f.estado !== 'ya aplicado').length, 'de', filas.length)

await pool.end()
