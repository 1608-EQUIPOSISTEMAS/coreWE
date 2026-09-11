// Alta de la venta BECA del "DIP PROC Y MEJORA V4" para EDITH SAWYERS CABRACA,
// con el contacto sacado de su venta 13964 (N8N: AGENTES IA).
//
// OJO con la version: "V4" es el program_versions.abbreviation (lo que muestra el
// ERP), NO el sufijo del version_code. "DIP PROC Y MEJORA V4" = PC-DZ-05 = pv 209,
// la version vigente; PC-DZ-04 (pv 65) se llama "V3" y esta de baja.
//
// La cohorte la nombra el usuario por su modulo 3: "LEAN SIX SIGMA YELLOW E56".
// edition_structure dice que la unica edicion de PC-DZ-05 cuyo LSS Yellow es E56
// (15088) es E3-26 / global E3 = edicion 15564, y ahi cae el resto del arbol.
//
// Se convalida GESTION DE PROCESOS (pv 55): ya lo llevo en la edicion 14962 (E51),
// que es justo el modulo 1 de esa misma cohorte -> misma edicion, same_edition.
// Por regla del negocio (validation.entity.js: buildEditionPlan) cualquier modulo
// convalidado dispara E0: el padre queda con program_edition_id NULL -- eso es el
// MARCADOR de E0, no un error -- y los 4 modulos restantes nacen como hijos SEG
// individuales con la edicion del arbol del padre.
//
// Sin Odoo ni correo: es un alta administrativa por script, no el flujo del asesor.
// Si hay que inscribirla en el aula y avisarle, va aparte y a conciencia.
//
//   node scripts/alta-beca-dip-procesos-v4-edith.mjs           # dry-run
//   node scripts/alta-beca-dip-procesos-v4-edith.mjs --apply
import { writeFileSync } from 'node:fs'

const APLICAR = process.argv.includes('--apply')

const VENTA_ORIGEN   = 13964    // de aqui sale el contacto
const USER_RAFI      = 21       // "lo registro el user RAFI"
const ASESOR_WEB     = 37       // asesor WEB (convencion de las ventas web)
const DIPLOMADO_PV   = 209      // PC-DZ-05, abbreviation "DIP PROC Y MEJORA V4"
const COHORTE_ED     = 15564    // E3-26 / E3: su LSS Yellow es E56 (15088)
const LSS_E56        = 15088    // guarda: la cohorte se identifica por este modulo
const CONVALIDADO_PV = 55       // GESTION DE PROCESOS (ya la llevo en E51 = 14962,
                                // que es el modulo 1 de esta misma cohorte)
const BECA_DSCT_ID   = 17       // discounts: 'GLOBAL/BECA 100%'
const LISTA_USD      = 919.00   // program_pricing pv 209, DOLARES + PROFESIONAL
const CAT_DOLARES    = 3042
const CAT_MOD_NORMAL = 2626     // la cohorte del diplomado va Normal, no Flexible
const CAT_CONTADO    = 2466
// "Venta de enero": el SP clava registration_date = NOW(), asi que la fecha se
// corrige al final. Ultimo dia habil de enero 2026 (viernes); la cohorte E4-26
// abre el 2026-05-02, asi que una venta de enero es una preventa normal.
const FECHA_VENTA    = '2026-01-30 10:00:00'

const NOTA = 'BECA 100% - DIP PROC Y MEJORA V4 cohorte E3-26 (LSS YELLOW E56). '
  + 'Convalida GESTION DE PROCESOS (venta 2019, ed. E51). Registrado por RAFI.'

await import('../src/modules/fico/fico.bootstrap.js') // sin esto logAudit es no-op
const { pool, query: q } = await import('../src/shared/db/pool.js')
const { createChildEnrollments, setPorts } = await import('../src/modules/fico/validation/validation.usecases.js')

// Alta administrativa: nada de inscribir en Odoo ni mandar el correo de bienvenida.
setPorts({ enrollInOdoo: async () => null, sendConfirmationEmail: async () => null })

const salir = async (codigo) => { await pool.end(); process.exit(codigo) }

const contactoDe = async (enrollmentId) => {
  const { rows } = await q(
    `SELECT p.person_id, p.first_name, p.last_name, p.document_number, p.cat_type_document,
            MAX(CASE WHEN ce.alias = 'we_way_contact_email' THEN pc.value END) AS email,
            MAX(CASE WHEN ce.alias = 'we_way_contact_phone' THEN pc.value END) AS phone
       FROM enrollments e
       JOIN customers c        ON c.customer_id = e.customer_id
       JOIN persons p          ON p.person_id = c.person_id
       JOIN person_contacts pc ON pc.person_id = p.person_id AND pc.active = 'Y'
       JOIN catalog ce         ON ce.catalog_id = pc.cat_way_contact
      WHERE e.enrollment_id = $1
      GROUP BY p.person_id, p.first_name, p.last_name, p.document_number, p.cat_type_document`,
    [enrollmentId])
  return rows[0]
}

// El nombre va tal cual esta guardado: fn_person_resolve pisa persons.first_name /
// last_name con lo que reciba, y un "arreglo" de nombre aca le cambia la ficha a
// la alumna en todas sus ventas.
const registrarVentaBeca = async (contacto) => {
  const inscription = {
    first_name: contacto.first_name,
    last_name: contacto.last_name,
    document_number: contacto.document_number,
    cat_type_document: contacto.cat_type_document,
    email: contacto.email,
    phone: contacto.phone,
    program_version_id: DIPLOMADO_PV,
    program_edition_id: COHORTE_ED,
    client_profile: 'profesional',
    seller_agent_id: ASESOR_WEB,
    agent_origin: 'WEB',
    is_scholarship: true,          // -> total_amount 0, discount_amount = list_price
    dsct_porcent_id: BECA_DSCT_ID, // deja rastro del 100% en enrollment_discounts
    list_price: LISTA_USD,
    cat_currency: CAT_DOLARES,
    cat_insc_modality: CAT_MOD_NORMAL,
    cat_payment_way: CAT_CONTADO,
    observations: NOTA
  }

  // El refcursor solo vive dentro de una transaccion: sin el BEGIN el CALL commitea
  // la venta y el FETCH revienta con "no existe el cursor", dejando el alta a medias.
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    const { rows } = await c.query(
      'CALL public.sp_fico_enrollment_register_direct($1, $2, $3)',
      [USER_RAFI, JSON.stringify({ inscription }), 'cur'])
    const { rows: salida } = await c.query(`FETCH ALL FROM ${rows[0].p_cur}`)
    await c.query('COMMIT')
    return salida[0]
  } catch (err) {
    await c.query('ROLLBACK')
    throw err
  } finally {
    c.release()
  }
}

const convalidarModulo1 = (padreId) => q(
  `INSERT INTO enrollment_validations
     (enrollment_id, child_version_id, validation_type, custom_edition_id, notes, status, requested_by)
   VALUES ($1, $2, 'same_edition', NULL, $3, 'pending', $4)`,
  [padreId, CONVALIDADO_PV, NOTA, USER_RAFI])

// El SP y insertChildEnrollment clavan NOW(): la venta de enero se fecha aca, y de
// una sola vez para el padre, sus hijos y la cuota beca (si no, la hoja FICO y los
// reportes por mes leen la fecha de hoy).
const fecharVenta = async (padreId) => {
  const { rows } = await q(
    `WITH familia AS (
       SELECT enrollment_id FROM enrollments WHERE enrollment_id = $1 OR parent_enrollment_id = $1
     ), ventas AS (
       UPDATE enrollments
          SET registration_date = $2::timestamp,
              modification_date = $2::timestamp,
              user_modification_id = $3
        WHERE enrollment_id IN (SELECT enrollment_id FROM familia)
        RETURNING enrollment_id
     ), cuotas AS (
       UPDATE payment_installments
          SET due_date = $2::date
        WHERE enrollment_id IN (SELECT enrollment_id FROM familia)
        RETURNING installment_id
     )
     SELECT (SELECT COUNT(*) FROM ventas) AS ventas, (SELECT COUNT(*) FROM cuotas) AS cuotas`,
    [padreId, FECHA_VENTA, USER_RAFI])
  return rows[0]
}

const familiaDe = (padreId) => q(
  `SELECT e.enrollment_id, e.parent_enrollment_id, pv.version_code AS modulo,
          pr.program_name, pe.global_code AS ed, pe.start_date::date AS inicio,
          ts.description AS estado, e.total_amount, e.discount_amount, e.list_price,
          e.registration_date::date AS venta, e.seller_agent_id, e.user_registration_id
     FROM enrollments e
     LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
     LEFT JOIN programs pr         ON pr.program_id = pv.program_id
     LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
     LEFT JOIN catalog ts          ON ts.catalog_id = e.cat_type_status
    WHERE e.enrollment_id = $1 OR e.parent_enrollment_id = $1
    ORDER BY e.parent_enrollment_id NULLS FIRST, e.enrollment_id`,
  [padreId]).then(r => r.rows)

const contacto = await contactoDe(VENTA_ORIGEN)
if (!contacto) { console.error(`La venta ${VENTA_ORIGEN} no existe o no tiene contacto.`); await salir(1) }
console.log('--- contacto sacado de la venta', VENTA_ORIGEN, '---')
console.table([contacto])

// Idempotencia: una segunda corrida no le vende el diplomado dos veces, y si el
// alta quedo a medias (venta creada pero sin hijos ni fecha) retoma desde ahi.
const { rows: [ventaPrevia] } = await q(
  `SELECT e.enrollment_id, e.registration_date::date AS venta
     FROM enrollments e JOIN customers c ON c.customer_id = e.customer_id
    WHERE c.person_id = $1 AND e.program_version_id = $2
      AND e.parent_enrollment_id IS NULL AND e.active = 'Y'`,
  [contacto.person_id, DIPLOMADO_PV])
if (ventaPrevia) console.log(`\nYa existe la venta ${ventaPrevia.enrollment_id} (${ventaPrevia.venta}): se retoma el flujo desde ahi.`)

// Guardas de identidad: el usuario pidio el programa por su nombre corto y la
// cohorte por su modulo 3. Los IDs de arriba tienen que seguir significando eso.
// La primera guarda existe porque "V4" es el abbreviation y no el sufijo del
// version_code: PC-DZ-04 se llama "V3", y confundirlos da de alta otro diplomado.
const { rows: [version] } = await q(
  `SELECT pv.abbreviation, pv.version_code, pv.active
     FROM program_versions pv WHERE pv.program_version_id = $1`, [DIPLOMADO_PV])
if (version?.abbreviation !== 'DIP PROC Y MEJORA V4') {
  console.error(`pv ${DIPLOMADO_PV} ya no es "DIP PROC Y MEJORA V4" sino "${version?.abbreviation}": revisar a mano.`)
  await salir(1)
}

const { rows: [arbol] } = await q(
  `SELECT COUNT(*) AS modulos,
          COUNT(*) FILTER (WHERE child_edition_id = $2) AS lss_e56
     FROM edition_structure WHERE parent_edition_id = $1`,
  [COHORTE_ED, LSS_E56])
if (Number(arbol.lss_e56) !== 1) {
  console.error(`La cohorte ${COHORTE_ED} ya no lleva LEAN SIX SIGMA YELLOW E56 (${LSS_E56}): revisar a mano.`)
  await salir(1)
}
console.log(`\n${version.abbreviation} (${version.version_code}), cohorte ${COHORTE_ED}: `
  + `${arbol.modulos} modulos en el arbol, LSS YELLOW E56 confirmado`)

if (!APLICAR) {
  console.log(`\nDRY-RUN. Con --apply: venta BECA (total 0, descuento ${LISTA_USD} USD) `
    + `en la cohorte ${COHORTE_ED}, convalida pv ${CONVALIDADO_PV}, 4 hijos SEG por E0, `
    + `todo fechado ${FECHA_VENTA}, registrado por user ${USER_RAFI} con asesor ${ASESOR_WEB} (WEB).`)
  await salir(0)
}

let alta = null
let PADRE = ventaPrevia?.enrollment_id
if (!PADRE) {
  alta = await registrarVentaBeca(contacto)
  console.log('\nSP register_direct ->', alta)
  if (Number(alta?.result) !== 1) { console.error('El SP rechazo el alta: no se toca nada mas.'); await salir(1) }
  PADRE = alta.enrollment_id
}

const { rows: convalidaciones } = await q('SELECT 1 FROM enrollment_validations WHERE enrollment_id = $1', [PADRE])
if (convalidaciones.length === 0) await convalidarModulo1(PADRE)

const { rows: hijosPrevios } = await q('SELECT 1 FROM enrollments WHERE parent_enrollment_id = $1', [PADRE])
if (hijosPrevios.length === 0) {
  console.log('createChildEnrollments ->', await createChildEnrollments({ enrollmentId: PADRE, userId: USER_RAFI }))
} else {
  console.log(`createChildEnrollments -> omitido: ${hijosPrevios.length} hijo(s) ya existen`)
}

console.log('fecharVenta ->', await fecharVenta(PADRE))

const familia = await familiaDe(PADRE)
console.log('\n--- familia resultante ---')
console.table(familia)
writeFileSync(new URL(`./_backup_alta_beca_dip_procesos_${PADRE}.json`, import.meta.url),
  JSON.stringify({ contacto, alta, familia }, null, 2))
await salir(0)
