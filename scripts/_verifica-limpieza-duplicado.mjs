// TAREA C: comprobar que la persona duplicada 19629 / customer 18387 ya no
// aparece en ninguna busqueda de alumnos. Solo LECTURA.
import 'dotenv/config'
import pg from 'pg'
const m = (process.env.DATABASE_URL || '').match(/^postgresql:\/\/([^:]+):([^@]+)@/)
const c = new pg.Client({ host: '127.0.0.1', port: 55432, database: 'neondb', user: 'postgres', password: process.env.PGPASSWORD || decodeURIComponent(m[2]) })
await c.connect()
const show = async (l, sql, p = []) => { const r = await c.query(sql, p); console.log('\n=== ' + l + ' (' + r.rowCount + ') ==='); console.table(r.rows) }

await show('Estado del duplicado', `
  select p.person_id, p.active persona, cu.customer_id, cu.active customer,
         (select count(*) from enrollments e where e.customer_id=cu.customer_id) enrollments,
         (select count(*) from person_contacts pc where pc.person_id=p.person_id and pc.active='Y') contactos_activos,
         (select count(*) from leads l where l.person_id=p.person_id) leads
    from persons p left join customers cu on cu.person_id=p.person_id
   where p.person_id in (19573,19629) order by p.person_id`)

// Funciones/SP de BD que leen persons: cuales NO filtran por active
await show('SPs/funciones que leen persons y NO filtran active', `
  select p.proname,
         (pg_get_functiondef(p.oid) ilike '%persons%') lee_persons,
         (pg_get_functiondef(p.oid) ~* 'per\\.active|per_?sons?\\.active|p\\.active\\s*=\\s*''Y''') filtra_active
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.prokind in ('f','p')
     and pg_get_functiondef(p.oid) ilike '%persons%'
   order by 3, 1`)

// Vistas que leen persons
await show('Vistas que leen persons', `
  select c.relname, c.relkind,
         (pg_get_viewdef(c.oid, true) ~* 'per\\.active|p\\.active') filtra_active
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind in ('v','m')
     and pg_get_viewdef(c.oid, true) ilike '%persons%'
   order by 1`)

// Simulacion: la duplicada aparece si busco por nombre / correo / telefono?
await show('Busqueda por NOMBRE (sin filtro active) - lo que veria una query ingenua', `
  select p.person_id, p.active, trim(concat_ws(' ', p.first_name, p.last_name)) nombre
    from persons p where p.first_name ilike '%CARLOTA%' and p.last_name ilike '%FLORES%'`)
await show('Busqueda por CORREO en contactos ACTIVOS', `
  select pc.person_id, pc.value, pc.active from person_contacts pc
   where pc.value ilike '%carlotaazucenaflores%' and pc.active='Y'`)
await show('Busqueda via ENROLLMENTS (camino real del panel FICO)', `
  select e.enrollment_id, e.customer_id, cu.person_id, p.active persona_activa
    from enrollments e join customers cu on cu.customer_id=e.customer_id
    join persons p on p.person_id=cu.person_id
   where p.first_name ilike '%CARLOTA%' and p.last_name ilike '%FLORES%' order by e.enrollment_id`)
await c.end()
