import 'dotenv/config'
import pg from 'pg'
const m = (process.env.DATABASE_URL || '').match(/^postgresql:\/\/([^:]+):([^@]+)@/)
const c = new pg.Client({ host: '127.0.0.1', port: 55432, database: 'neondb', user: 'postgres', password: process.env.PGPASSWORD || decodeURIComponent(m[2]) })
await c.connect()
const show = async (l, sql, p = []) => { const r = await c.query(sql, p); console.log('\n=== ' + l + ' (' + r.rowCount + ') ==='); console.table(r.rows) }
await show('14709 + familia', `
  select e.enrollment_id, e.parent_enrollment_id padre, e.customer_id, cu.person_id, pv.version_code,
         e.program_edition_id ed, e.cat_type_status estado, e.cat_payment_plan plan, e.total_amount,
         e.odoo_user_id, e.odoo_email
    from enrollments e join customers cu on cu.customer_id=e.customer_id
    left join program_versions pv on pv.program_version_id=e.program_version_id
   where e.enrollment_id in (14596,14709) or e.parent_enrollment_id=14709 order by e.enrollment_id`)
await show('duplicado desactivado', `
  select p.person_id, p.active persona_activa,
         (select count(*) from person_contacts pc where pc.person_id=p.person_id and pc.active='Y') contactos_activos,
         (select count(*) from enrollments e join customers cu on cu.customer_id=e.customer_id where cu.person_id=p.person_id) enrollments
    from persons p where p.person_id in (19573,19629) order by p.person_id`)
await show('MV: aparecen padre y los 3 hijos', `
  select "ID","NOMBRES COMPLETOS","COD","ESTADO ALUMNO","TOTAL A PAGAR","PAID_AMOUNT"
    from mv_enrollment_report_system where "ID" in (14596,14709,14713,14714,14715) order by "ID"`)
await show('audit nuevo de 14709 y sus hijos', `
  select enrollment_id, action, performed_by, left(coalesce(justificacion,details),80) txt
    from enrollment_audit_log where enrollment_id in (14709,14713,14714,14715) and audit_id > 29722 order by audit_id`)
await c.end()
