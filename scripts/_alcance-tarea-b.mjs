import 'dotenv/config'
import pg from 'pg'
const m = (process.env.DATABASE_URL || '').match(/^postgresql:\/\/([^:]+):([^@]+)@/)
const c = new pg.Client({ host: '127.0.0.1', port: 55432, database: 'neondb', user: 'postgres', password: process.env.PGPASSWORD || decodeURIComponent(m[2]) })
await c.connect()
const show = async (l, sql, p = []) => { const r = await c.query(sql, p); console.log('\n=== ' + l + ' (' + r.rowCount + ') ==='); console.table(r.rows) }

const EXCLUDE_IMPORTED = `
   AND COALESCE(e.notes,'') NOT LIKE '%masiva FICO%'
   AND NOT EXISTS (SELECT 1 FROM enrollments p WHERE p.enrollment_id=e.parent_enrollment_id AND COALESCE(p.notes,'') LIKE '%masiva FICO%')`
const SYNC_FROM = `
   AND (SELECT COALESCE(
          (SELECT lf.pay_date FROM leads lf WHERE lf.enrollment_id=fam.enrollment_id LIMIT 1),
          (SELECT py.payment_date::date FROM payments py WHERE py.enrollment_id=fam.enrollment_id AND py.active='Y' ORDER BY py.payment_date ASC LIMIT 1),
          fam.registration_date::date)
        FROM enrollments fam WHERE fam.enrollment_id=COALESCE(e.parent_enrollment_id,e.enrollment_id)) >= DATE '2026-04-28'`
const CC_DEST = `EXISTS (SELECT 1 FROM course_changes cc WHERE cc.enrollment_destination_id=e.enrollment_id AND cc.active='Y')`

// Las 3 hojas comparten exactamente la misma CTE `approved`, asi que el delta es el mismo.
await show('Filas NUEVAS por el fix (identicas en Ventas / Consolidado / Cuotas)', `
  SELECT e.enrollment_id, e.parent_enrollment_id origen, pv.version_code cod,
         CASE WHEN e.program_edition_id IS NULL THEN 'E0' ELSE 'con ed' END ed,
         c_plan.description plan, e.total_amount,
         trim(concat_ws(' ', per.first_name, per.last_name)) alumno
    FROM enrollments e
    JOIN catalog cf ON cf.catalog_id=e.cat_fico_status
    JOIN customers cu ON cu.customer_id=e.customer_id JOIN persons per ON per.person_id=cu.person_id
    LEFT JOIN program_versions pv ON pv.program_version_id=e.program_version_id
    LEFT JOIN catalog c_plan ON c_plan.catalog_id=e.cat_payment_plan
   WHERE cf.alias='we_enrollment_status_checked' AND e.active='Y'
     AND e.parent_enrollment_id IS NOT NULL AND ${CC_DEST}
     ${EXCLUDE_IMPORTED} ${SYNC_FROM}
   ORDER BY e.enrollment_id`)

await show('Control: hijas de paquete que SIGUEN excluidas', `
  SELECT count(*) hijas_de_paquete_fuera
    FROM enrollments e JOIN catalog cf ON cf.catalog_id=e.cat_fico_status
   WHERE cf.alias='we_enrollment_status_checked' AND e.active='Y'
     AND e.parent_enrollment_id IS NOT NULL AND NOT ${CC_DEST}`)

await show('Caso borde: destinos de CC cuyo ORIGEN es un import (quedan fuera por EXCLUDE_IMPORTED)', `
  SELECT e.enrollment_id, e.parent_enrollment_id origen, pv.version_code, e.total_amount,
         trim(concat_ws(' ', per.first_name, per.last_name)) alumno, left(o.notes,45) notes_origen
    FROM enrollments e
    JOIN enrollments o ON o.enrollment_id = e.parent_enrollment_id
    JOIN catalog cf ON cf.catalog_id=e.cat_fico_status
    JOIN customers cu ON cu.customer_id=e.customer_id JOIN persons per ON per.person_id=cu.person_id
    LEFT JOIN program_versions pv ON pv.program_version_id=e.program_version_id
   WHERE cf.alias='we_enrollment_status_checked' AND e.active='Y' AND ${CC_DEST}
     AND COALESCE(o.notes,'') LIKE '%masiva FICO%'
   ORDER BY e.enrollment_id`)
await c.end()
