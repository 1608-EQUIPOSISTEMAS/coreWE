// Lista las ordenes de servicio / de pago que HOY estan entrando al sync de
// Sheets. Existe porque una OS se registra con su monto y su cuota "pagada"
// antes de que el dinero llegue: para la BD es indistinguible de una venta
// cobrada (misma cuota `we_inst_paid`, mismo pago activo, misma liquidacion
// pendiente), asi que el unico freno es HELD_ENROLLMENT_IDS, que se llena a mano.
//
// Correr despues de cada tanda de OS nuevas: lo que salga aca ya esta sumando en
// el Google Sheet, y negocio tiene que confirmar cuales cobro de verdad.
//
// Uso:  node scripts/auditar-os-en-sync.mjs
import { q, pool } from './db.mjs'
import { SYNC_FROM_DATE, IMPORT_OBSERVATION_TOKEN, HELD_ENROLLMENT_IDS }
  from '../src/modules/integration/integration.repository.js'

// Dos poblaciones distintas: las OS nuevas traen `cat_b2b_doctype`, pero las
// viejas (Molitalia, Grupo Tawa) solo se declaran en el texto de `notes`.
// Buscar unicamente por doctype las dejaba fuera de la auditoria.
const DETECTA_OS = `(
        cd.alias IN ('we_enrollment_b2b_doctype_service_order',
                     'we_enrollment_b2b_doctype_purchase_order')
        OR e.notes ILIKE '%orden de servicio%'
        OR e.notes ILIKE '%orden de compra%'
        OR e.notes ILIKE 'OS,%'
        OR e.notes ILIKE 'OP,%'
      )`

// El CTE `approved` filtra por fecha con una subconsulta correlacionada que en
// Neon tarda minutos sobre toda la tabla. Aca el universo son unas decenas de
// filas, asi que la fecha efectiva se calcula en el SELECT y se compara como
// texto ISO: `Date >= '2026-04-28'` convierte la fecha a numero y da NaN.
const { rows } = await q(`
  SELECT e.enrollment_id,
         pr.first_name || ' ' || pr.last_name AS alumno,
         e.total_amount,
         COALESCE(replace(cd.alias, 'we_enrollment_b2b_doctype_', ''), 'solo en notes') AS doctype,
         COALESCE(
           (SELECT lf.pay_date FROM public.leads lf WHERE lf.enrollment_id = e.enrollment_id LIMIT 1),
           (SELECT MIN(py.payment_date)::date FROM public.payments py
             WHERE py.enrollment_id = e.enrollment_id AND py.active = 'Y'),
           e.registration_date::date
         )::text AS f_pago,
         (SELECT string_agg(DISTINCT replace(cl.alias, 'we_settlement_status_', ''), ',')
            FROM public.payments py
            JOIN public."catalog" cl ON cl.catalog_id = py.cat_settlement_status
           WHERE py.enrollment_id = e.enrollment_id AND py.active = 'Y') AS liquidacion,
         (COALESCE(e.notes, '') LIKE '%${IMPORT_OBSERVATION_TOKEN}%') AS marcador_import,
         EXISTS (SELECT 1 FROM public.payments py
                  WHERE py.enrollment_id = e.enrollment_id AND py.active = 'Y') AS tiene_pago,
         e.parent_enrollment_id
    FROM public.enrollments e
    JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
    LEFT JOIN public."catalog" cd ON cd.catalog_id = e.cat_b2b_doctype
    JOIN public.customers c ON c.customer_id = e.customer_id
    JOIN public.persons pr ON pr.person_id = c.person_id
   WHERE cf.alias = 'we_enrollment_status_checked'
     AND e.active = 'Y'
     AND ${DETECTA_OS}
   ORDER BY e.enrollment_id`)

const retenida = new Set(HELD_ENROLLMENT_IDS)
// Espeja EXCLUDE_UNCOLLECTED_SERVICE_ORDER: una OS/OP con monto y sin ningun
// pago activo todavia no se cobro y el sync ya la deja fuera sola.
const osSinCobrar = (r) => r.doctype !== 'solo en notes' && Number(r.total_amount) > 0 && !r.tiene_pago
const entraAlSync = (r) =>
  !retenida.has(r.enrollment_id) &&
  !retenida.has(r.parent_enrollment_id) &&
  !osSinCobrar(r) &&
  !r.marcador_import &&
  r.parent_enrollment_id === null &&
  r.f_pago >= SYNC_FROM_DATE

console.log('BD:', (await q('SELECT current_database() AS db')).rows[0].db)
console.log('retenidas hoy:', HELD_ENROLLMENT_IDS.join(', ') || '(ninguna)')
const dentro = rows.filter(entraAlSync)
console.log(`\nOS/OP detectadas: ${rows.length} | entrando al sync: ${dentro.length}`)
console.table(dentro.map(({ parent_enrollment_id, marcador_import, ...r }) => r))
const frenadas = rows.filter(r => osSinCobrar(r) && !retenida.has(r.enrollment_id))
console.log(`
OS/OP frenadas por no tener cobro registrado: ${frenadas.length}`)
console.table(frenadas.map(({ parent_enrollment_id, marcador_import, ...r }) => r))
await pool.end()
