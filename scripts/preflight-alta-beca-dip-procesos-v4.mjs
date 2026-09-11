// Preflight de produccion para alta-beca-dip-procesos-v4-edith.mjs: confirma en
// que BD estamos parados y que cada ID que el alta lleva clavado significa ahi lo
// mismo que en el clon local. Solo lee, no escribe nada.
//
//   node scripts/preflight-alta-beca-dip-procesos-v4.mjs
import { q, pool } from './db.mjs'

const show = async (t, sql, p) => { const r = await q(sql, p); console.log('\n---', t, '---'); console.table(r.rows) }

await show('donde estamos parados', `
  SELECT current_database() AS bd, inet_server_port() AS puerto,
         (SELECT COUNT(*) FROM enrollments) AS enrollments,
         (SELECT MAX(enrollment_id) FROM enrollments) AS ultimo_id`)

await show('venta origen del contacto (13964)', `
  SELECT e.enrollment_id, p.person_id, p.first_name, p.last_name, p.document_number,
         pr.program_name
    FROM enrollments e
    JOIN customers c ON c.customer_id = e.customer_id
    JOIN persons p   ON p.person_id = c.person_id
    LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN programs pr         ON pr.program_id = pv.program_id
   WHERE e.enrollment_id = 13964`)

await show('version "DIP PROC Y MEJORA V4"', `
  SELECT program_version_id, version_code, abbreviation, active
    FROM program_versions WHERE abbreviation LIKE 'DIP PROC Y MEJORA%' ORDER BY program_version_id`)

await show('cohortes de esa version que llevan LSS YELLOW E56', `
  SELECT es.parent_edition_id, pp.specific_code, pp.global_code, pp.program_version_id,
         pv.abbreviation, pp.start_date::date AS inicio, pp.active
    FROM edition_structure es
    JOIN program_editions pp  ON pp.edition_num_id = es.parent_edition_id
    JOIN program_versions pv  ON pv.program_version_id = pp.program_version_id
   WHERE es.child_edition_id = 15088 AND pv.abbreviation = 'DIP PROC Y MEJORA V4'`)

await show('arbol de la cohorte 15564', `
  SELECT es.sort_order, ch.edition_num_id, ch.global_code, ch.start_date::date AS inicio,
         pvc.program_version_id AS pv, pvc.abbreviation
    FROM edition_structure es
    JOIN program_editions ch  ON ch.edition_num_id = es.child_edition_id
    JOIN program_versions pvc ON pvc.program_version_id = ch.program_version_id
   WHERE es.parent_edition_id = 15564 ORDER BY es.sort_order`)

await show('precio pv 209 en DOLARES', `
  SELECT cat_currency_id, cat_profile_id, list_price, active
    FROM program_pricing WHERE program_version_id = 209 AND cat_currency_id = 3042`)

await show('su GESTION DE PROCESOS (el modulo que se convalida)', `
  SELECT e.enrollment_id, e.program_edition_id, pe.global_code, pe.start_date::date AS inicio,
         cs.description AS estado
    FROM enrollments e
    JOIN customers c ON c.customer_id = e.customer_id
    LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN catalog cs          ON cs.catalog_id = e.cat_type_status
   WHERE c.person_id = (SELECT c2.person_id FROM enrollments e2
                          JOIN customers c2 ON c2.customer_id = e2.customer_id
                         WHERE e2.enrollment_id = 13964)
     AND e.program_version_id = 55`)

await show('ya tiene el diplomado?', `
  SELECT e.enrollment_id, e.registration_date::date AS venta, e.active
    FROM enrollments e JOIN customers c ON c.customer_id = e.customer_id
   WHERE c.person_id = (SELECT c2.person_id FROM enrollments e2
                          JOIN customers c2 ON c2.customer_id = e2.customer_id
                         WHERE e2.enrollment_id = 13964)
     AND e.program_version_id = 209`)

await show('usuarios y catalogos clavados en el alta', `
  SELECT 'user RAFI'    AS que, user_id::text AS id, alias AS valor FROM users WHERE user_id = 21
  UNION ALL SELECT 'asesor WEB', user_id::text, alias FROM users WHERE user_id = 37
  UNION ALL SELECT 'descuento beca', discount_id::text, description FROM discounts WHERE discount_id = 17
  UNION ALL SELECT 'moneda', catalog_id::text, description FROM catalog WHERE catalog_id = 3042
  UNION ALL SELECT 'modalidad', catalog_id::text, description FROM catalog WHERE catalog_id = 2626
  UNION ALL SELECT 'forma de pago', catalog_id::text, description FROM catalog WHERE catalog_id = 2466`)

await show('SP y funcion de identidad desplegados', `
  SELECT p.proname,
         (pg_get_functiondef(p.oid) LIKE '%is_scholarship%') AS soporta_beca
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('sp_fico_enrollment_register_direct', 'fn_person_resolve')`)

await pool.end()
