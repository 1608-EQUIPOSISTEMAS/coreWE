// One-off (grupo A): importa la cadena RP de ESPINOZA CELESTINO MARIA DEL PILAR
// (DNI 77221249) desde la hoja FICO -> filas 209 (origen RP, BI-DZ-02 E32) y
// 246 (destino ACT, BI-DZ-02 E33). Borrar cuando ya este replicado a produccion.
//
//   node scripts/importar-rp-espinoza-77221249.mjs                 # DRY-RUN
//   node scripts/importar-rp-espinoza-77221249.mjs --aplicar
//   node scripts/importar-rp-espinoza-77221249.mjs --aplicar --precio-lista=3860
//
// La conexion sale de ./db.mjs (Backend/.env): correrlo contra produccion es
// apuntar el .env al tunel, nada mas. Es idempotente: cada paso comprueba el
// estado real antes de escribir, asi que re-ejecutarlo no duplica nada.
//
// Que deja (modelo RP del repo, ver .claude/agents/agente-importacion):
//   origen  -> RP (conserva su edicion vieja y la beca 100%), sus 5 hijos a R
//   destino -> inscripcion NUEVA ACT pago cero, sin parent_enrollment_id, con
//              sus 5 hijos SEG creados por el puerto normal del modulo FICO
//   audit   -> edition_reprogrammed (origen) + created_from_rp (destino)
//
// NO encola register_followup ni toca Odoo/correo: la hoja trae ENVIO = OK, el
// correo ya salio a mano y volver a mandarlo seria un envio duplicado.
import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import '../src/modules/fico/fico.bootstrap.js' // cablea logAudit + createChildEnrollments
import { enrollmentRepository as repo } from '../src/modules/fico/enrollment/enrollment.repository.js'
import { q, pool } from './db.mjs'

// --- El caso, tal como llega de la hoja FICO --------------------------------

const USER_ID = 9 // ADMIN: el import no lo hizo un asesor.

const ALUMNO = {
  document_number: '77221249',
  cat_type_document: 2300,            // DNI
  first_name: 'MARIA DEL PILAR',
  last_name: 'ESPINOZA CELESTINO',
  email: 'maria.espinoza@adecconegocio.com.pe',
  phone: '982691219',
  client_profile: 'profesional'       // OCUP = P
}

const PROGRAMA = { program_version_id: 39, version_code: 'BI-DZ-02' }

// La beca vive en el ORIGEN (DSCT 100%, INGRESO 0, SALDO 0). El DESTINO nace
// pago cero por convencion del RP (list 0, sin fila de descuento): su total 0 no
// es una beca propia, la venta real es la del origen.
const ORIGEN = {
  fila_hoja: 209,
  program_edition_id: 15360,          // E32 / E3-26, inicio 25/03/2026
  edicion_label: 'E32',
  inicio_label: '25/03/2026',
  registration_date: '2026-03-21',
  agent_origin: 'B2B',                // columna AS
  obs_hoja: 'REPROGRAMO'
}

const DESTINO = {
  fila_hoja: 246,
  program_edition_id: 15380,          // E33 / E4-26, inicio 25/04/2026
  edicion_label: 'E33',
  inicio_label: '25/04/2026',
  registration_date: '2026-04-25',
  agent_origin: 'SA',                 // columna AS = S/A (sin asesor)
  obs_hoja: 'VIENE DE UNA RP'
}

const JUSTIFICACION =
  'Importacion manual de la cadena RP de la hoja FICO (filas ' + ORIGEN.fila_hoja +
  ' y ' + DESTINO.fila_hoja + '): ' + PROGRAMA.version_code + ' ' + ORIGEN.edicion_label +
  ' -> ' + DESTINO.edicion_label + ', alumna DNI ' + ALUMNO.document_number +
  '. Beca 100%, sin cuotas ni pagos. Correo y Odoo ya resueltos a mano ' +
  '(ENVIO = OK en la hoja): no se encola register_followup.'

// El sync a Google Sheets ignora lo que lleve 'masiva FICO' en notes
// (EXCLUDE_IMPORTED). Ambas filas YA existen en la hoja: sin este marcador el
// proximo sync las volveria a subir duplicadas.
const MARCADOR_SYNC = 'Importacion masiva FICO (hoja)'

const notasOrigen = (destinoId) =>
  MARCADOR_SYNC + ' fila ' + ORIGEN.fila_hoja + ' - BECA 100%. ' + ORIGEN.obs_hoja +
  ': reprogramado a ' + PROGRAMA.version_code + ' ' + DESTINO.edicion_label +
  ' (inscripcion #' + destinoId + ').'

// El marcador 'Reprogramacion desde inscripcion #' es funcional, no decorativo:
// el contador del aula lo usa para clasificar al destino como SEGUI y NO como
// BECA (edition.repository.classroomChannelMetricsList).
const notasDestino = (origenId) =>
  'Reprogramacion desde inscripcion #' + origenId + ' (' + PROGRAMA.version_code + ' ' +
  ORIGEN.edicion_label + '). ' + DESTINO.obs_hoja + '. ' + MARCADOR_SYNC +
  ' fila ' + DESTINO.fila_hoja + '.'

// --- CLI --------------------------------------------------------------------

const aplicar = process.argv.includes('--aplicar')
const precioCli = Number(
  (process.argv.find(a => a.startsWith('--precio-lista=')) || '').split('=')[1]
)

// --- Catalogos por alias (los ids duros cambian de BD en BD) -----------------

const ALIASES = {
  act: 'we_inscription_way_act',
  rp: 'we_enrollment_status_reprogrammed',
  retirado: 'we_enrollment_status_retired',
  seg: 'we_enrollment_status_tracking',
  ficoChecked: 'we_enrollment_status_checked',
  certPagado: 'we_certificate_status_paid',
  contado: 'we_payment_way_single',
  profesional: 'we_profile_professional',
  modalidadNormal: 'we_insc_modality_normal',
  soles: 'we_currency_soles',
  canalGeneral: 'we_channel_general'
}

async function cargarCatalogos () {
  const { rows } = await q(
    'SELECT alias, catalog_id FROM catalog WHERE alias = ANY($1::text[])',
    [Object.values(ALIASES)]
  )
  const porAlias = new Map(rows.map(r => [r.alias, r.catalog_id]))
  const cat = {}
  for (const [nombre, alias] of Object.entries(ALIASES)) {
    const id = porAlias.get(alias)
    if (!id) throw new Error('Catalogo ausente en esta BD: ' + alias)
    cat[nombre] = id
  }
  return cat
}

async function descuentoBeca100 () {
  const { rows } = await q("SELECT discount_id FROM discounts WHERE alias = '100_global' AND active")
  if (!rows[0]) throw new Error("No existe el descuento global 100% (alias '100_global')")
  return rows[0].discount_id
}

// --- Precio de lista de la beca ---------------------------------------------
//
// Beca 100% = list_price real + discount_amount = list_price + total 0. Un
// list_price 0 haria pasar la beca por "venta gratis" y el panel FICO no podria
// mostrar cuanto se regalo. La hoja no trae el precio (todas las columnas de
// dinero vienen vacias), asi que se toma del catalogo y, si falta, del precio
// que repiten las demas ventas de la misma version.

async function precioDeCatalogo () {
  const { rows } = await q(
    `SELECT price_profesional_soles AS precio FROM program_price
      WHERE program_version_id = $1 AND active = 'Y'
      ORDER BY program_price_id DESC LIMIT 1`, [PROGRAMA.program_version_id]
  )
  return Number(rows[0]?.precio) || null
}

async function precioMasVendido () {
  const { rows } = await q(
    `SELECT list_price::numeric AS precio, count(*) AS ventas
       FROM enrollments
      WHERE program_version_id = $1 AND parent_enrollment_id IS NULL
        AND active = 'Y' AND list_price > 0
      GROUP BY 1 ORDER BY ventas DESC, precio DESC LIMIT 1`, [PROGRAMA.program_version_id]
  )
  return rows[0] ? { precio: Number(rows[0].precio), ventas: Number(rows[0].ventas) } : null
}

async function resolverPrecioLista () {
  if (precioCli > 0) return { precio: precioCli, fuente: '--precio-lista (CLI)' }

  const catalogo = await precioDeCatalogo()
  if (catalogo) return { precio: catalogo, fuente: 'program_price.price_profesional_soles' }

  const moda = await precioMasVendido()
  if (moda) {
    return { precio: moda.precio, fuente: 'list_price mas frecuente de la version (' + moda.ventas + ' ventas)' }
  }

  throw new Error(
    'Sin precio de lista para pv ' + PROGRAMA.program_version_id + ': pasar --precio-lista=<monto>'
  )
}

// --- Lectura del estado actual ----------------------------------------------

const buscarInscripcion = (editionId) => q(
  `SELECT e.enrollment_id
     FROM enrollments e
     JOIN customers c ON c.customer_id = e.customer_id
     JOIN persons p   ON p.person_id   = c.person_id
    WHERE p.document_number = $1
      AND e.program_version_id = $2
      AND e.program_edition_id = $3
      AND e.parent_enrollment_id IS NULL
      AND e.active = 'Y'
    ORDER BY e.enrollment_id LIMIT 1`,
  [ALUMNO.document_number, PROGRAMA.program_version_id, editionId]
).then(r => r.rows[0]?.enrollment_id || null)

const hijosDe = (padreId) => q(
  `SELECT e.enrollment_id, pv.version_code, pe.global_code AS edicion,
          pe.start_date::date AS inicio, e.total_amount,
          c.description AS estado, cp.description AS plan
     FROM enrollments e
     LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
     LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
     LEFT JOIN catalog c  ON c.catalog_id  = e.cat_type_status
     LEFT JOIN catalog cp ON cp.catalog_id = e.cat_payment_plan
    WHERE e.parent_enrollment_id = $1
    ORDER BY pe.start_date, e.enrollment_id`, [padreId]
).then(r => r.rows)

const cabecera = (ids) => q(
  `SELECT e.enrollment_id, pe.global_code AS edicion, cts.description AS estado,
          e.registration_date::date AS f_registro, e.list_price, e.discount_amount,
          e.total_amount, e.agent_origin, e.seller_agent_id,
          cpp.description AS plan_pago, e.parent_enrollment_id,
          cf.description AS fico, cc.description AS certificado, e.notes,
          (SELECT COALESCE(SUM(pi.amount), 0) FROM payment_installments pi
            WHERE pi.enrollment_id = e.enrollment_id) AS suma_cuotas,
          (SELECT count(*) FROM payments pa WHERE pa.enrollment_id = e.enrollment_id) AS pagos
     FROM enrollments e
     LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
     LEFT JOIN catalog cts ON cts.catalog_id = e.cat_type_status
     LEFT JOIN catalog cpp ON cpp.catalog_id = e.cat_payment_plan
     LEFT JOIN catalog cf  ON cf.catalog_id  = e.cat_fico_status
     LEFT JOIN catalog cc  ON cc.catalog_id  = e.cat_certificate_status
    WHERE e.enrollment_id = ANY($1::int[]) ORDER BY e.enrollment_id`, [ids]
).then(r => r.rows)

// --- Altas ------------------------------------------------------------------

// Payload comun de registerDirect. El SP resuelve la persona con
// fn_person_resolve (regla unica de identidad) y crea customer + contactos.
function inscripcionBase (cat) {
  return {
    ...ALUMNO,
    program_version_id: PROGRAMA.program_version_id,
    cat_insc_modality: cat.modalidadNormal,
    cat_currency: cat.soles,
    cat_payment_channel: cat.canalGeneral,
    cat_payment_way: cat.contado,       // saldado en 0: no hay cronograma
    cat_payment_medium: null,           // la hoja no trae medio de pago
    cat_b2b_doctype: null,
    seller_agent_id: null,
    parent_enrollment_id: null,
    ticket_payment_urls: [],
    installment_plan: null
  }
}

async function registrar (inscription, etiqueta) {
  const res = await repo.registerDirect({ userId: USER_ID, inscription })
  if (res.result !== 1 || !res.enrollment_id) {
    throw new Error('registerDirect fallo en ' + etiqueta + ': ' + res.message)
  }
  console.log('  + ' + etiqueta + ' creado: #' + res.enrollment_id)
  return res.enrollment_id
}

async function crearOrigen (cat, precioLista, becaId) {
  return registrar({
    ...inscripcionBase(cat),
    program_edition_id: ORIGEN.program_edition_id,
    agent_origin: ORIGEN.agent_origin,
    payment_date: ORIGEN.registration_date,
    // Beca 100%: pago cero declarado + el descuento que lo explica.
    is_scholarship: true,
    list_price: precioLista,
    total_amount: 0,
    saved_money: 0,
    dsct_porcent_id: becaId,
    observations: MARCADOR_SYNC + ' fila ' + ORIGEN.fila_hoja + ' - BECA 100%. ' + ORIGEN.obs_hoja + '.'
  }, 'ORIGEN (RP)')
}

async function crearDestino (cat, origenId) {
  return registrar({
    ...inscripcionBase(cat),
    program_edition_id: DESTINO.program_edition_id,
    agent_origin: DESTINO.agent_origin,
    payment_date: DESTINO.registration_date,
    // Convencion del RP: destino pago cero sin marca de beca ni descuento
    // fantasma. La venta (y la beca) viven en el origen.
    is_scholarship: true,
    list_price: 0,
    total_amount: 0,
    saved_money: 0,
    observations: notasDestino(origenId)
  }, 'DESTINO (ACT)')
}

// Hijos SEG por el puerto del modulo (repo.createChildEnrollments, cableado en
// fico.bootstrap). isE0 = false aqui: las 5 aulas cuelgan del arbol del padre,
// asi que no dispara Odoo ni correo.
async function crearHijos (padreId, etiqueta) {
  const previos = await hijosDe(padreId)
  if (previos.length > 0) {
    console.log('  = ' + etiqueta + ': ya tiene ' + previos.length + ' hijo(s), no se recrean')
    return previos
  }
  const { createdChildren } = await repo.createChildEnrollments({ enrollmentId: padreId, userId: USER_ID })
  console.log('  + ' + etiqueta + ': ' + createdChildren.length + ' hijo(s) SEG creados')
  return hijosDe(padreId)
}

async function retirarHijos (origenId, cat) {
  const activos = await repo.getActiveChildren(origenId, cat.retirado)
  for (const hijo of activos) {
    await repo.retireChild(hijo.enrollment_id, cat.retirado)
    await repo.logAudit({
      enrollmentId: hijo.enrollment_id,
      action: 'retired',
      userId: USER_ID,
      justificacion: JUSTIFICACION,
      details: 'Retirado por reprogramacion del programa padre #' + origenId + ' hacia ' +
               PROGRAMA.version_code + ' ' + DESTINO.edicion_label
    })
  }
  console.log('  + ORIGEN: ' + activos.length + ' hijo(s) pasados a R')
}

// --- Ajustes que el SP no puede hacer (fechas de la hoja, estado RP) ---------
//
// Van juntos en UNA transaccion: dejan la cabecera del origen y la del destino
// consistentes entre si. Los pasos de arriba (SP register_direct y el puerto de
// hijos) usan el pool compartido del backend y no se pueden meter en este mismo
// BEGIN; por eso cada uno es idempotente por separado.

async function ajustarCabeceras ({ origenId, destinoId, cat, precioLista, becaId }) {
  const cliente = await pool.connect()
  try {
    await cliente.query('BEGIN')

    await cliente.query(
      `UPDATE enrollments SET
         registration_date      = $2::timestamp,
         cat_type_status        = $3,
         cat_payment_plan       = $4,
         cat_profile_id         = $5,
         cat_fico_status        = $6,
         cat_certificate_status = $7,
         cat_currency           = $8,
         agent_origin           = $9,
         seller_agent_id        = NULL,
         list_price             = $10,
         discount_amount        = $10,
         total_amount           = 0,
         notes                  = $11,
         user_modification_id   = $12,
         modification_date      = NOW()
       WHERE enrollment_id = $1`,
      [origenId, ORIGEN.registration_date, cat.rp, cat.contado, cat.profesional,
        cat.ficoChecked, cat.certPagado, cat.soles, ORIGEN.agent_origin,
        precioLista, notasOrigen(destinoId), USER_ID]
    )

    // Red de seguridad: si el SP no dejo la fila del descuento, la beca se
    // quedaria sin explicacion en el panel.
    await cliente.query(
      `INSERT INTO enrollment_discounts
         (enrollment_id, discount_id, order_applied, calculated_amount, applied_at, user_registration_id)
       VALUES ($1, $2, 1, $3, NOW(), $4)
       ON CONFLICT (enrollment_id, discount_id)
       DO UPDATE SET calculated_amount = EXCLUDED.calculated_amount`,
      [origenId, becaId, precioLista, USER_ID]
    )

    await cliente.query(
      `UPDATE enrollments SET
         registration_date      = $2::timestamp,
         cat_type_status        = $3,
         cat_payment_plan       = $4,
         cat_profile_id         = $5,
         cat_fico_status        = $6,
         cat_certificate_status = $7,
         cat_currency           = $8,
         agent_origin           = $9,
         seller_agent_id        = NULL,
         parent_enrollment_id   = NULL,
         list_price             = 0,
         discount_amount        = 0,
         total_amount           = 0,
         notes                  = $10,
         user_modification_id   = $11,
         modification_date      = NOW()
       WHERE enrollment_id = $1`,
      [destinoId, DESTINO.registration_date, cat.act, cat.contado, cat.profesional,
        cat.ficoChecked, cat.certPagado, cat.soles, DESTINO.agent_origin,
        notasDestino(origenId), USER_ID]
    )

    // Los hijos nacen con registration_date = NOW(): en un import historico eso
    // fecharia el aula en el dia de la corrida.
    await cliente.query(
      `UPDATE enrollments h SET registration_date = p.registration_date
         FROM enrollments p
        WHERE h.parent_enrollment_id = p.enrollment_id
          AND p.enrollment_id = ANY($1::int[])
          AND h.registration_date::date <> p.registration_date::date`,
      [[origenId, destinoId]]
    )

    // Misma razon para la cuota 0 que el SP crea en toda venta pago cero: nace
    // con due_date = hoy y en un import historico eso la fecha fuera del caso.
    await cliente.query(
      `UPDATE payment_installments pi SET due_date = e.registration_date::date
         FROM enrollments e
        WHERE e.enrollment_id = pi.enrollment_id
          AND pi.enrollment_id = ANY($1::int[])
          AND pi.due_date <> e.registration_date::date`,
      [[origenId, destinoId]]
    )

    await cliente.query('COMMIT')
  } catch (err) {
    await cliente.query('ROLLBACK')
    throw err
  } finally {
    cliente.release()
  }
  console.log('  + cabeceras ajustadas (fechas de la hoja, RP en el origen, notas)')
}

// --- Bitacora ---------------------------------------------------------------

const yaAuditado = (enrollmentId, action) => q(
  'SELECT 1 FROM enrollment_audit_log WHERE enrollment_id = $1 AND action = $2 LIMIT 1',
  [enrollmentId, action]
).then(r => r.rowCount > 0)

async function auditarCadena ({ origenId, destinoId, hijosOrigen }) {
  const edicion = {
    old: ORIGEN.edicion_label + ' (' + ORIGEN.inicio_label + ')',
    new: DESTINO.edicion_label + ' (' + DESTINO.inicio_label + ')'
  }

  if (!await yaAuditado(origenId, 'edition_reprogrammed')) {
    await repo.logAudit({
      enrollmentId: origenId,
      action: 'edition_reprogrammed',
      userId: USER_ID,
      justificacion: JUSTIFICACION,
      changes: {
        Edicion: edicion,
        'Nuevo enrollment': { old: '---', new: '#' + destinoId },
        'Cuotas trasladadas': { old: '---', new: 'ninguna (beca 100%, saldo 0)' },
        'Modulos retirados': { old: '---', new: hijosOrigen.length + ' modulo(s) a R' },
        old_edition_id: ORIGEN.program_edition_id,
        new_edition_id: DESTINO.program_edition_id,
        new_enrollment_id: destinoId
      },
      details: 'Reprogramacion de edicion: ' + edicion.old + ' -> ' + edicion.new +
               '. Nueva inscripcion #' + destinoId + '. Reconstruida desde la hoja FICO (fila ' +
               ORIGEN.fila_hoja + ' -> fila ' + DESTINO.fila_hoja + ').'
    })
    console.log('  + audit edition_reprogrammed en el origen')
  }

  if (!await yaAuditado(destinoId, 'created_from_rp')) {
    await repo.logAudit({
      enrollmentId: destinoId,
      action: 'created_from_rp',
      userId: USER_ID,
      justificacion: JUSTIFICACION,
      changes: {
        'Edicion origen': { old: '---', new: edicion.old },
        'Edicion nueva': { old: '---', new: edicion.new },
        'Enrollment origen': { old: '---', new: '#' + origenId }
      },
      details: 'Creado por reprogramacion de #' + origenId + ': ' + edicion.old + ' -> ' +
               edicion.new + '. Sin cuotas heredadas (beca 100%). Correo y Odoo ya ' +
               'gestionados a mano (ENVIO = OK).'
    })
    console.log('  + audit created_from_rp en el destino')
  }
}

// --- Verificacion final -----------------------------------------------------

async function verificar (origenId, destinoId, cat) {
  const filas = await cabecera([origenId, destinoId])
  console.log('\n=== CABECERAS ===')
  console.table(filas.map(f => ({
    id: f.enrollment_id, edicion: f.edicion, estado: f.estado, f_registro: f.f_registro,
    lista: f.list_price, dscto: f.discount_amount, total: f.total_amount,
    cuotas: f.suma_cuotas, pagos: f.pagos, canal: f.agent_origin, asesor: f.seller_agent_id,
    plan: f.plan_pago, fico: f.fico, cert: f.certificado, padre: f.parent_enrollment_id
  })))
  console.log('\nnotes origen :', filas.find(f => f.enrollment_id === origenId)?.notes)
  console.log('notes destino:', filas.find(f => f.enrollment_id === destinoId)?.notes)

  for (const [etiqueta, id] of [['ORIGEN', origenId], ['DESTINO', destinoId]]) {
    console.log('\n=== HIJOS ' + etiqueta + ' #' + id + ' ===')
    console.table(await hijosDe(id))
  }

  const { rows: descuentos } = await q(
    `SELECT ed.enrollment_id, ed.discount_id, d.description, ed.calculated_amount
       FROM enrollment_discounts ed JOIN discounts d ON d.discount_id = ed.discount_id
      WHERE ed.enrollment_id = ANY($1::int[]) ORDER BY ed.enrollment_id`, [[origenId, destinoId]]
  )
  console.log('\n=== DESCUENTOS ===')
  console.table(descuentos)

  const { rows: audit } = await q(
    `SELECT enrollment_id, action, performed_at::date AS fecha, details
       FROM enrollment_audit_log WHERE enrollment_id = ANY($1::int[])
      ORDER BY enrollment_id, audit_id`, [[origenId, destinoId]]
  )
  console.log('\n=== AUDITORIA (padres) ===')
  console.table(audit)

  const { rows: sanity } = await q(
    `SELECT e.enrollment_id, e.total_amount,
            COALESCE((SELECT SUM(pi.amount) FROM payment_installments pi
                       WHERE pi.enrollment_id = e.enrollment_id), 0) AS suma_cuotas,
            e.cat_type_status, e.parent_enrollment_id
       FROM enrollments e
      WHERE e.enrollment_id = ANY($1::int[]) OR e.parent_enrollment_id = ANY($1::int[])
      ORDER BY e.enrollment_id`, [[origenId, destinoId]]
  )
  const descuadres = sanity.filter(r => Number(r.total_amount) !== Number(r.suma_cuotas))
  const hijosNoSeg = sanity.filter(
    r => r.parent_enrollment_id && ![cat.seg, cat.retirado].includes(r.cat_type_status)
  )

  console.log('\n=== SANITY ===')
  console.log('  sum(cuotas) = total_amount en ' + sanity.length + ' fila(s): ' +
    (descuadres.length === 0 ? 'OK' : 'FALLA'))
  if (descuadres.length) console.table(descuadres)
  console.log('  hijos en SEG/R: ' + (hijosNoSeg.length === 0 ? 'OK' : 'FALLA'))
  if (hijosNoSeg.length) console.table(hijosNoSeg)

  return descuadres.length === 0 && hijosNoSeg.length === 0
}

// La matview usa los encabezados de la hoja FICO como nombres de columna
// ("ID", "ESTADO ALUMNO", ...): van entre comillas dobles si o si.
async function refrescarMv (ids) {
  // CONCURRENTLY como el cron del backend (fico-mv-refresh.cron.js): tarda ~4s y
  // bloquea escrituras, no lecturas. Sin CONCURRENTLY son minutos de ACCESS
  // EXCLUSIVE, o sea el panel FICO congelado para todos mientras corre el import.
  console.log('\nREFRESH MATERIALIZED VIEW CONCURRENTLY mv_enrollment_report_system ...')
  console.time('  refresh')
  await q('REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_enrollment_report_system')
  console.timeEnd('  refresh')
  const { rows } = await q(
    `SELECT "ID", "COD", "NOMBRES COMPLETOS", "ESTADO ALUMNO", "FECHA DE REGISTRO",
            "FECHA DE INICIO", "ASESOR", "TIPO DE PAGO", "DSTC. PRINCIPAL",
            "PRECIO LISTA", "TOTAL A PAGAR", "TOTAL DESCONTADO", "PAID_AMOUNT"
       FROM mv_enrollment_report_system WHERE "ID" = ANY($1::int[]) ORDER BY "ID"`, [ids]
  )
  console.log('=== FILAS EN LA MV (panel FICO) ===')
  console.table(rows)
  if (rows.length !== ids.length) {
    console.log('  OJO: la MV devolvio ' + rows.length + ' de ' + ids.length + ' fila(s) esperadas.')
  }
}

// --- Orquestacion -----------------------------------------------------------

const cat = await cargarCatalogos()
const becaId = await descuentoBeca100()
const { precio: precioLista, fuente } = await resolverPrecioLista()

let origenId = await buscarInscripcion(ORIGEN.program_edition_id)
let destinoId = await buscarInscripcion(DESTINO.program_edition_id)

console.log('=== CASO ===')
console.log('  alumna      : ' + ALUMNO.last_name + ' ' + ALUMNO.first_name + ' (DNI ' + ALUMNO.document_number + ')')
console.log('  programa    : ' + PROGRAMA.version_code + ' (pv ' + PROGRAMA.program_version_id + ')')
console.log('  origen  E32 : edicion ' + ORIGEN.program_edition_id + ' -> ' + (origenId ? 'ya existe #' + origenId : 'a crear'))
console.log('  destino E33 : edicion ' + DESTINO.program_edition_id + ' -> ' + (destinoId ? 'ya existe #' + destinoId : 'a crear'))
console.log('  beca 100%   : discount_id ' + becaId + ', list_price ' + precioLista + ' (' + fuente + ')')

if (!aplicar) {
  console.log('\nDRY-RUN: no se escribio nada. Repetir con --aplicar.')
  await pool.end()
  process.exit(0)
}

console.log('\n=== APLICANDO ===')
if (!origenId) origenId = await crearOrigen(cat, precioLista, becaId)
else console.log('  = ORIGEN ya existe (#' + origenId + '), no se recrea')

const hijosOrigen = await crearHijos(origenId, 'ORIGEN')

if (!destinoId) destinoId = await crearDestino(cat, origenId)
else console.log('  = DESTINO ya existe (#' + destinoId + '), no se recrea')

await crearHijos(destinoId, 'DESTINO')
await retirarHijos(origenId, cat)
await ajustarCabeceras({ origenId, destinoId, cat, precioLista, becaId })
await auditarCadena({ origenId, destinoId, hijosOrigen })

writeFileSync(
  new URL('./_backup_rp_' + ALUMNO.document_number + '.json', import.meta.url),
  JSON.stringify({
    caso: JUSTIFICACION,
    aplicado_en: new Date().toISOString(),
    origen: { enrollment_id: origenId, hijos: await hijosDe(origenId) },
    destino: { enrollment_id: destinoId, hijos: await hijosDe(destinoId) }
  }, null, 2)
)

const ok = await verificar(origenId, destinoId, cat)
await refrescarMv([origenId, destinoId])

console.log('\nRESULTADO: origen #' + origenId + ' (RP) -> destino #' + destinoId +
  ' (ACT). Sanity ' + (ok ? 'OK' : 'CON FALLAS') + '.')
await pool.end()
process.exit(ok ? 0 : 1)
