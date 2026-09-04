import { pool } from '../../shared/db/pool.js'
import { google } from 'googleapis'
import path from 'path'
import { WebClient } from '@slack/web-api'
import { ALIAS } from '../../utils/catalog-aliases.js'

// Capa de infraestructura del modulo integration. Centraliza el acceso a la
// base de datos, a Google Sheets y a Slack para que los usecases no instancien
// clientes externos. El SQL vive aqui verbatim: las queries son identicas a las
// del service legacy, solo cambia donde residen.
//
// Pendiente arquitectonico: la instanciacion de googleapis y de @slack/web-api
// deberia migrar a shared/adapters dedicados (SheetsPort + nuevas operaciones
// del SlackPort). Ver sharedAdditionsNeeded del reporte de migracion. Mientras
// no existan esos adapters compartidos, este repository es la unica frontera de
// I/O del modulo, lo que mantiene los usecases libres de dependencias externas.

const SLACK_TOKEN = process.env.SLACK_TOKEN
const SLACK_CHANNEL = process.env.SLACK_CHANNEL_MATCH_WEB

// IDs de los spreadsheets destino. Nombres semanticos para evitar escribir en la
// hoja equivocada. Pendiente: mover a variables de entorno via el SheetsPort.
const SPREADSHEET = {
  enrollment: '1ehfYdzIW115KmfUtzFyLrFFnk2PJHy9Vmp4nYLsbvxo',
  insc: '1B4NAcmk1QjwLV_NhfP4FPkQrdFWLdanvIg_gkPufCPg',
  schedule: '1vZHEs2URSJOxiBVlnwwgwKV-W-g_pWqdv-Y1wtXmfUc',
  prospectos: '1plkAWdZvcIRt2fRi-nK9NQKuHy86yj2pMD9mtjAxZHc',
  fico: '19ALxQ0OhKDyjLY9WOowgN275ji81YXZ91uLQWDOeF_c',
  cronograma26: '1kh6HLxrg47qW2rkKh-UmEXkOgiGGLz7_wu6mpfT0KEM'
}

// Cliente de Google Sheets autenticado con la cuenta de servicio en disco.
async function getGoogleSheets () {
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(process.cwd(), 'credentials/service.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  const authClient = await auth.getClient()
  return google.sheets({ version: 'v4', auth: authClient })
}

// Verifica que la hoja exista en el spreadsheet; si no, la crea y escribe la
// fila de headers. Idempotente: si ya existe, no hace nada.
async function ensureSheetExists (googleSheets, spreadsheetId, sheetName, headersRow) {
  const meta = await googleSheets.spreadsheets.get({ spreadsheetId })
  const exists = (meta.data?.sheets || []).some(s => s.properties?.title === sheetName)
  if (exists) return false

  await googleSheets.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: { requests: [{ addSheet: { properties: { title: sheetName } } }] }
  })

  if (headersRow && headersRow.length > 0) {
    await googleSheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetName}'!A1`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [headersRow] }
    })
  }
  return true
}

// Filtro temporal del sync FICO -> Google Sheets: excluye las inscripciones
// cargadas por la importacion masiva (notes 'Importacion/Migracion masiva FICO
// ...') para no re-subir data historica mientras dura la migracion. El resto del
// sistema usa 'Registro directo FICO', asi que el patron no toca ventas normales.
// La columna real en enrollments es `notes` (el SP mapea el campo JSON
// `observations` -> notes). COALESCE evita que filas con notes NULL caigan al
// NULL NOT LIKE (= excluidas por error).
//
// Doble condicion: (1) la fila no es import; (2) su PADRE no es import. Las hijas
// de paquete deberian heredar el note 'hijo de paquete', pero hay hijas creadas
// sin el (paquetes viejos / via SP), asi que se excluyen mirando el note del
// padre. En getFicoAula (incluye hijas) es el que las atrapa. En las otras 3 el
// NOT EXISTS ya no es trivial: desde PARENT_OR_CC_DESTINATION esas queries
// admiten destinos de CC, que SI tienen padre, y este chequeo los deja fuera si
// el origen del cambio venia de la importacion masiva.
// ponytail: quitar ${EXCLUDE_IMPORTED} de las 4 CTEs `approved` cuando la migracion termine.
export const EXCLUDE_IMPORTED = `
         AND COALESCE(e.notes, '') NOT LIKE '%masiva FICO%'
         AND NOT EXISTS (
               SELECT 1 FROM public.enrollments p
                WHERE p.enrollment_id = e.parent_enrollment_id
                  AND COALESCE(p.notes, '') LIKE '%masiva FICO%'
             )`
// Token que el note de la importacion masiva debe contener para ser excluido.
export const IMPORT_OBSERVATION_TOKEN = 'masiva FICO'

// Ventas del flujo VIEJO de ordenes de servicio, retenidas a mano: la
// inscripcion ya esta verificada pero todavia no se cobro, y el negocio no la
// cuenta hasta que pague. Ahi la orden se declaraba escribiendola en `notes`,
// asi que no hay forma de reconocerla por dato y hay que enumerarlas.
// Cuando el alumno paga se borra su id de aqui. Igual que ZERO_AMOUNT_EMAILS,
// editar la lista exige redeploy.
// ponytail: lista en codigo; las OS nuevas ya no la necesitan (ver abajo).
//
// 13790 y 13791 (Grupo Tawa, S/328 c/u) cobradas el 2026-08-28: liberadas.
export const HELD_ENROLLMENT_IDS = [14344, 14345, 14346, 14347, 14348]

// Retiene tambien a las hijas de paquete: sin esto la venta del padre no sube
// pero sus hijos SEG si. La lista vacia devuelve '' porque `NOT IN ()` no es SQL
// valido.
export const EXCLUDE_HELD = HELD_ENROLLMENT_IDS.length === 0
  ? ''
  : `
         AND e.enrollment_id NOT IN (${HELD_ENROLLMENT_IDS.join(', ')})
         AND COALESCE(e.parent_enrollment_id, 0) NOT IN (${HELD_ENROLLMENT_IDS.join(', ')})`

// Flujo NUEVO: el asesor marca la venta como Orden de Servicio / de Compra y
// FICO la aprueba sin cobrar, porque la empresa deposita semanas despues
// (`markCheckedWithoutPayment` en fico/payment-confirmation). Hasta ese momento
// no hay plata y la venta no debe sumar en el Sheet; entraba igual, y solo se
// frenaba metiendola a mano en HELD_ENROLLMENT_IDS.
//
// La senal es la ausencia de `payments`: la OS sin cobrar se aprueba sin ninguna
// fila de pago, y `sp_fico_confirm_payment` crea la primera recien cuando FICO
// registra el cobro. Entonces la venta entra sola en la siguiente sincronizacion,
// sin lista ni redeploy.
//
// NO sirve mirar `cat_settlement_status`: los 6167 pagos activos de produccion
// dicen "Pendiente de liquidacion", nadie liquida nunca. Tampoco el estado de la
// cuota: queda `we_inst_paid` en las dos.
//
// Solo aplica con monto > 0. Las ventas documentales B2B de total 0 (cartas de
// compromiso y las OC de convenio) no tienen nada que cobrar: excluirlas
// borraria al alumno de las hojas sin que hubiera un ingreso pendiente detras.
export const EXCLUDE_UNCOLLECTED_SERVICE_ORDER = `
         AND NOT EXISTS (
           SELECT 1
             FROM public.enrollments os
             JOIN public."catalog" c_doc ON c_doc.catalog_id = os.cat_b2b_doctype
            WHERE os.enrollment_id = COALESCE(e.parent_enrollment_id, e.enrollment_id)
              AND c_doc.alias IN ('${ALIAS.B2B_DOCTYPE_SERVICE_ORDER}',
                                  '${ALIAS.B2B_DOCTYPE_PURCHASE_ORDER}')
              AND os.total_amount > 0
              AND NOT EXISTS (
                    SELECT 1 FROM public.payments py
                     WHERE py.enrollment_id = os.enrollment_id AND py.active = 'Y'
                  )
         )`

// Todo lo aprobado pero aun no cobrado, que es lo que ninguna hoja debe sumar:
// la lista manual del flujo viejo mas la regla automatica de las OS nuevas.
// Se aplica a las 7 CTEs `approved` para que ventas, aula, pagos, adicionales y
// convenios cuenten lo mismo.
export const EXCLUDE_UNCOLLECTED = EXCLUDE_HELD + EXCLUDE_UNCOLLECTED_SERVICE_ORDER

// El destino de un Cambio de Curso lleva parent_enrollment_id = origen (lo setea
// finalizeCourseChange), asi que el filtro "parent_enrollment_id IS NULL" que deja
// fuera a las hijas de paquete tambien lo dejaba fuera de las hojas de ventas: la
// venta del curso nuevo (y su pago) quedaba invisible. `course_changes` es
// justamente la tabla que separa "hijo por CC" de "hijo de paquete", asi que se
// usa para readmitir SOLO a los destinos de CC.
export const PARENT_OR_CC_DESTINATION = `
         AND (
           e.parent_enrollment_id IS NULL
           OR EXISTS (
                SELECT 1 FROM public.course_changes cc
                 WHERE cc.enrollment_destination_id = e.enrollment_id
                   AND cc.active = 'Y'
              )
         )`

// Un evento/congreso se reconoce por dos vias, las mismas que usa
// shared/event-category.js: la inscripcion tiene categoria de entrada
// (VIP/GENERAL/PREMIUM/VIRTUAL) o su programa es de tipo evento. Basta
// cualquiera: las categorias se agregaron despues, asi que los congresos viejos
// solo se distinguen por el tipo de programa.
export const IS_EVENT = `
         AND (
           e.cat_event_category IS NOT NULL
           OR EXISTS (
                SELECT 1
                  FROM public.program_versions pv_ev
                  JOIN public.programs prog_ev ON prog_ev.program_id = pv_ev.program_id
                  JOIN public."catalog" c_type_ev ON c_type_ev.catalog_id = prog_ev.cat_type_program
                 WHERE pv_ev.program_version_id = e.program_version_id
                   AND c_type_ev.alias = 'we_program_type_event'
              )
         )`

// Corte temporal del sync FICO -> Sheets: solo ventas desde esta fecha.
// El corte usa la MISMA fecha efectiva que la columna F. PAGO de las hojas
// (lead.pay_date -> primer pago -> fecha de registro), no registration_date:
// hay ventas viejas registradas en el sistema meses despues y filtrarlas por
// registro las dejaba pasar. La familia entera (padre + hijas) se corta por la
// fecha del PADRE para que aparezcan o desaparezcan juntos.
export const SYNC_FROM_DATE = '2026-04-28'
export const SYNC_FROM = `
         AND (
           SELECT COALESCE(
                    (SELECT lf.pay_date FROM public.leads lf
                      WHERE lf.enrollment_id = fam.enrollment_id LIMIT 1),
                    (SELECT py.payment_date::date FROM public.payments py
                      WHERE py.enrollment_id = fam.enrollment_id AND py.active = 'Y'
                      ORDER BY py.payment_date ASC LIMIT 1),
                    fam.registration_date::date
                  )
             FROM public.enrollments fam
            WHERE fam.enrollment_id = COALESCE(e.parent_enrollment_id, e.enrollment_id)
         ) >= DATE '${SYNC_FROM_DATE}'`

// Corte propio de la hoja "7. Convenios": el negocio arranco el reporte de
// convenios el 2026-08-14, asi que solo suben las ventas B2B pagadas desde ese
// dia (inclusive). Es independiente de SYNC_FROM_DATE, que corta las otras
// hojas mucho antes.
export const CONVENIOS_FROM_DATE = '2026-08-14'

// Un operador FICO (ELFI, RAFI, MECA, MAFI) registra la venta o genera el link
// de pago, pero NO la vende: su codigo no puede figurar como ASESOR de la hoja
// (8 ventas B2B salieron como 'B2B - ELFI' / 'B2B - RAFI'). Sin asesor comercial
// detras la fila sale con el canal a secas — 'B2B' —, que es correcto: el
// negocio a veces gestiona el convenio asi, sin asesor asignado.
//
// Se resuelve por ROL y no por una lista de alias para que un operador FICO
// nuevo quede cubierto sin tocar codigo. Fail-open a proposito: un usuario sin
// ningun rol conserva su alias (hoy solo el usuario sintetico 'WEB').
export const NOT_FICO_OPERATOR = (u) => `(
        NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = ${u}.user_id)
        OR EXISTS (
             SELECT 1
               FROM public.user_roles ur
               JOIN public.rol r ON r.rol_id = ur.rol_id
              WHERE ur.user_id = ${u}.user_id
                AND r.alias NOT IN ('FICO', 'LIDER_FICO'))
      )`

// Marcador de venta B2B. Misma union que usa edition.repository.js para la
// columna B2B del cronograma: la venta puede venir marcada por el origen del
// asesor (el "cambio de asesor" a B2B deja agent_origin = 'B2B'), por el
// contrato, por el tipo de documento (OS/OP) o por el lead. Basta cualquiera.
// Asume en el scope los alias `e` (enrollments) y `l` (leads).
const IS_B2B = `
         AND (
           e.agent_origin = 'B2B'
           OR e.b2b_contract_id IS NOT NULL
           OR e.cat_b2b_doctype IS NOT NULL
           OR l.b2b = 'Y'
         )`

// Contacto efectivo del alumno, en el orden que manda negocio: lo que el lead
// trajo al vender y, si el lead no lo tiene, el ultimo contacto vigente de la
// persona. Las 6 queries FICO lo repetian verbatim. Asume en el scope los alias
// `l` (leads) y `per` (persons).
const STUDENT_EMAIL_SQL = `COALESCE(
        l.origin_email,
        (SELECT pc.value FROM public.person_contacts pc
          JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact AND c.alias = 'we_way_contact_email'
         WHERE pc.person_id = per.person_id AND pc.active = 'Y'
         ORDER BY pc.registration_date DESC LIMIT 1)
      )`
const STUDENT_PHONE_SQL = `COALESCE(
        l.origin_phone,
        (SELECT pc.value FROM public.person_contacts pc
          JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact AND c.alias = 'we_way_contact_phone'
         WHERE pc.person_id = per.person_id AND pc.active = 'Y'
         ORDER BY pc.registration_date DESC LIMIT 1)
      )`

export class IntegrationRepository {
  constructor (db = pool) {
    this.db = db
    this.SPREADSHEET = SPREADSHEET
    this.sheets = getGoogleSheets
    this.ensureSheetExists = ensureSheetExists
  }

  // ── Lecturas de BD ─────────────────────────────────────────────────────

  async getUserSheetConfig (user_id) {
    const r = await this.db.query(
      `SELECT sheet_id, sheet_spring FROM users WHERE user_id = $1`,
      [user_id]
    )
    return r.rows[0] || null
  }

  async getLeadsReport (user_id) {
    const r = await this.db.query(`SELECT * FROM public.sp_leads_report($1)`, [user_id])
    return r.rows || []
  }

  async getEnrollmentLead (enrollment_id) {
    const r = await this.db.query(`SELECT * FROM public.sp_enrollment_lead_get($1)`, [enrollment_id])
    return r.rows || []
  }

  async getScheduleReport () {
    const r = await this.db.query(`SELECT * FROM public.fn_reporte_ediciones_programas()`)
    return r.rows || []
  }

  async getProspectos () {
    const r = await this.db.query(`SELECT * FROM public.vw_r_prospectos`)
    return r.rows || []
  }

  async getEnrollmentReportAll () {
    const r = await this.db.query(`SELECT * FROM public.vw_enrollment_report`)
    return r.rows || []
  }

  async getEnrollmentReportNew () {
    const r = await this.db.query(
      `SELECT * FROM public.vw_enrollment_report WHERE "FLAG_SEND" = 'N'`
    )
    return r.rows || []
  }

  // Efecto secundario intencional: marca como enviadas las inscripciones ya
  // volcadas a la hoja SISTEMA-PILOTO. No revertir: sin esto las filas se
  // duplican en cada corrida.
  async markEnrollmentsSent (sentIds) {
    await this.db.query(
      `UPDATE public.enrollments SET flag_send = 'Y' WHERE enrollment_id = ANY($1::int[])`,
      [sentIds]
    )
  }

  async getEnrollmentWebForSlack (enrollment_id) {
    const result = await this.db.query(` SELECT
        e.enrollment_id,
        to_char(e.registration_date, 'DD/MM/YYYY HH24:MI') AS fecha_registro,
        prog.program_name,
        c_type.description AS tipo_programa,
        c_mod.description  AS modalidad,
        to_char(pe.start_date::timestamptz, 'DD/MM/YYYY') AS fecha_inicio,
        per.document_number AS dni,
        TRIM(BOTH FROM concat_ws(' ', per.first_name, per.last_name, per.mother_last_name)) AS alumno,
        concat('(', c_sitx.variable_2, ') ', l.origin_phone)  AS celular,
        l.origin_email  AS correo,
        c_sit.variable_1 AS ocupacion,
        concat(u.name,' - ', u.alias )          AS asesor,
        c_curr.description AS moneda,
        e.list_price,
        e.discount_amount,
        e.total_amount,
        e.notes,
        c_fico.description AS estado_financiero,
        -- Adjuntos del lead (constancias pago web)
        (
          SELECT json_agg(json_build_object(
            'url',  la.file_url,
            'name', COALESCE(la.file_name, 'Adjunto')
          ) ORDER BY la.lead_attachment_id)
          FROM public.lead_attachments la
          WHERE la.lead_id = l.lead_id AND la.active = 'Y'
        ) AS lead_attachments
      FROM public.enrollments e
      JOIN public.customers cust ON cust.customer_id = e.customer_id
      JOIN public.persons per    ON per.person_id = cust.person_id
      LEFT JOIN public.leads l         ON l.enrollment_id = e.enrollment_id
      LEFT JOIN public.users u         ON u.user_id = e.seller_agent_id
      LEFT JOIN public.program_versions ver ON ver.program_version_id = e.program_version_id
      LEFT JOIN public.programs prog        ON prog.program_id = ver.program_id
      LEFT JOIN public.program_editions pe  ON pe.edition_num_id = e.program_edition_id
      LEFT JOIN public.catalog c_type  ON c_type.catalog_id = prog.cat_type_program
      LEFT JOIN public.catalog c_mod   ON c_mod.catalog_id  = prog.cat_model_modality
      LEFT JOIN public.catalog c_fico  ON c_fico.catalog_id = e.cat_fico_status
      LEFT JOIN public.catalog c_sit   ON c_sit.catalog_id  = l.cat_prospect_situation
      LEFT JOIN public.catalog c_sitx   ON c_sitx.catalog_id  = l.cat_code_country
      LEFT JOIN public.catalog c_curr  ON c_curr.catalog_id = e.cat_currency
      WHERE e.enrollment_id = $1
      LIMIT 1`, [enrollment_id])
    return result.rows
  }

  async getFicoSales () {
    const { rows } = await this.db.query(`
    WITH approved AS (
      SELECT e.enrollment_id
        FROM public.enrollments e
        JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
       WHERE cf.alias = 'we_enrollment_status_checked'
         AND e.active = 'Y'
         ${PARENT_OR_CC_DESTINATION}
         ${EXCLUDE_IMPORTED}
         ${EXCLUDE_UNCOLLECTED}
         ${SYNC_FROM}
    ),
    -- Historico de momentos por telefono (misma fuente que sp_search_phone_get).
    -- Se usa como fallback cuando el lead no tiene cat_client_moment asignado:
    -- telefono con momento comunidad -> CWE, con cualquier historico -> LDS,
    -- sin historico -> NEW. La columna TIPO CLIENTE nunca debe quedar vacia.
    hist AS (
      SELECT co.phone,
             BOOL_OR(cm_h.alias = 'we_moment_cwd') AS has_cwd
        FROM public.consolidated co
        LEFT JOIN public."catalog" cm_h ON cm_h.catalog_id = co.cat_client_moment
       WHERE co.phone IS NOT NULL AND co.phone <> ''
       GROUP BY co.phone
    )
    SELECT
      pv.version_code                                     AS cod,
      CASE WHEN e.program_edition_id IS NULL THEN 'E0'
           ELSE COALESCE(pe.global_code, '')
      END                                                  AS ed,
      to_char(pe.start_date, 'DD/MM/YYYY')                 AS f_inicio,
      to_char(pay_eff.f_pago_date, 'DD/MM/YYYY')           AS f_pago,
      per.document_number                                  AS dni,
      TRIM(BOTH FROM concat_ws(' ', per.first_name, per.last_name, per.mother_last_name)) AS nombres,
      phone_eff.phone                                      AS celular,
      ${STUDENT_EMAIL_SQL}                                                    AS correo,
      CASE c_prof.alias
        WHEN 'we_profile_student' THEN 'E'
        ELSE 'P'
      END                                                  AS ocup,
      CASE
        WHEN e.agent_origin IS NOT NULL AND COALESCE(ag_token.alias, u.alias) IS NOT NULL
          THEN e.agent_origin || ' - ' || COALESCE(ag_token.alias, u.alias)
        ELSE COALESCE(ag_token.alias, u.alias, e.agent_origin, 'S/A')
      END                                                  AS asesor,
      CASE c_plan.alias
        WHEN 'we_payment_way_single'        THEN 'PT'
        WHEN 'we_payment_way_installments'  THEN 'PP'
        ELSE ''
      END                                                  AS estado,
      CASE
        WHEN COALESCE(e.list_price, 0) = 0 THEN ''
        ELSE replace(to_char(ROUND(e.discount_amount / e.list_price * 100, 2), 'FM999990.00'), '.', ',') || '%'
      END                                                  AS dsct,
      CASE
        WHEN COALESCE(pay_agg.total_paid, 0) >= (e.total_amount) THEN 'Saldado'
        WHEN inst_overdue.cnt > 0 THEN 'Deuda ' || inst_overdue.cnt::text
        ELSE 'Al dia'
      END                                                  AS al_dia,
      -- Misma logica de inicial que la hoja "2. Consolidado" (getFicoConsolidado):
      -- PT no genera cuota 0 (su pago es la cuota 1), asi que leer solo pi_res
      -- dejaba inicial=0 en todas las ventas al contado.
      CASE
        WHEN (e.total_amount) = 0 THEN '0'
        WHEN c_plan.alias = 'we_payment_way_single'
          THEN replace(to_char(COALESCE(pi_pt.amount, e.total_amount), 'FM999990.00'), '.', ',')
        WHEN c_plan.alias = 'we_payment_way_installments'
          THEN replace(to_char(COALESCE(pi_res.amount, 0), 'FM999990.00'), '.', ',')
        ELSE '0'
      END                                                  AS inicial,
      replace(to_char(GREATEST(0, (e.total_amount) - COALESCE(pay_agg.total_paid, 0)), 'FM999990.00'), '.', ',') AS saldo,
      replace(to_char(COALESCE(pay_agg.total_paid, 0), 'FM999990.00'), '.', ',') AS ingreso,
      CASE
        WHEN COALESCE(c_moment.variable_2, '') <> '' THEN c_moment.variable_2
        WHEN hist.has_cwd THEN 'CWE'
        WHEN hist.phone IS NOT NULL THEN 'LDS'
        ELSE 'NEW'
      END                                                  AS tipo_cliente,
      'ACT'                                                AS estado_alumno,
      -- MEMBRESIA: la propia venta de membresia muestra su abreviatura (WE BLACK...);
      -- los cursos comprados bajo membresia muestran el tier normalizado del enrollment.
      -- Sufijo -DESC cuando el socio pago ese curso usando el 60% de beneficio de la
      -- membresia (WE PLUS-DESC / WE GOLD-DESC). Desde el 2026-08-03 ese beneficio
      -- tiene descuento propio ("60% - MEMBRESIA", alias 60_membresia), pero las
      -- ventas anteriores se cargaron con el generico "GLOBAL 60%": por eso el
      -- criterio es "cualquier porcentaje de 60", no el alias del descuento.
      CASE WHEN COALESCE(prog.is_membership, false) THEN COALESCE(pv.abbreviation, '')
           WHEN mtier.abbreviation IS NULL THEN ''
           WHEN EXISTS (
             SELECT 1 FROM public.enrollment_discounts ed
               JOIN public.discounts d       ON d.discount_id  = ed.discount_id
               JOIN public."catalog" c_dtype ON c_dtype.catalog_id = d.cat_discount_type
              WHERE ed.enrollment_id = e.enrollment_id
                AND c_dtype.alias = 'we_discount_type_percentage'
                AND ROUND(d.value) = 60
           ) THEN mtier.abbreviation || '-DESC'
           ELSE mtier.abbreviation
      END                                                  AS membresia,
      CASE WHEN c_mod.alias = 'we_insc_modality_flexible' THEN 'FLEX' ELSE '' END AS flex
    FROM public.enrollments e
    JOIN approved a ON a.enrollment_id = e.enrollment_id
    JOIN public.customers cust ON cust.customer_id = e.customer_id
    JOIN public.persons per   ON per.person_id   = cust.person_id
    LEFT JOIN public.leads l            ON l.enrollment_id = e.enrollment_id
    LEFT JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN public.programs prog       ON prog.program_id = pv.program_id
    LEFT JOIN public.program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN public.users u             ON u.user_id = e.seller_agent_id
    LEFT JOIN public."catalog" c_prof    ON c_prof.catalog_id = e.cat_profile_id
    LEFT JOIN public."catalog" c_plan    ON c_plan.catalog_id = e.cat_payment_plan
    LEFT JOIN public."catalog" c_mod     ON c_mod.catalog_id  = e.cat_inscription_modality
    LEFT JOIN public."catalog" c_moment  ON c_moment.catalog_id = l.cat_client_moment
    LEFT JOIN LATERAL (
      SELECT pv_m.abbreviation
        FROM public.program_versions pv_m
       WHERE pv_m.program_id = e.membership_program_id AND pv_m.active = 'Y'
       ORDER BY pv_m.program_version_id DESC
       LIMIT 1
    ) mtier ON TRUE
    LEFT JOIN LATERAL (
      SELECT ${STUDENT_PHONE_SQL} AS phone
    ) phone_eff ON TRUE
    LEFT JOIN hist ON hist.phone = phone_eff.phone
    LEFT JOIN LATERAL (
      SELECT u_pt.alias
        FROM public.payment_tokens pt
        LEFT JOIN public.users u_pt ON u_pt.user_id = COALESCE(pt.requested_by, pt.created_by)
       WHERE pt.enrollment_id = e.enrollment_id
       ORDER BY pt.token_id ASC
       LIMIT 1
    ) ag_token ON TRUE
    LEFT JOIN LATERAL (
      -- Sumar monto de cuotas marcadas como pagadas, no de la tabla payments.
      -- Razon: payments puede tener filas duplicadas (re-confirmaciones que no
      -- desactivaron la fila previa). El estado canonico de "cuota saldada"
      -- vive en payment_installments.cat_status.
      -- Aceptamos ambos aliases que el sistema usa como sinonimos de "paid":
      -- 'we_inst_paid' (legacy) y 'we_payment_status_paid' (nuevo).
      SELECT COALESCE(SUM(pi.amount), 0) AS total_paid
        FROM public.payment_installments pi
        JOIN public."catalog" cs_pi ON cs_pi.catalog_id = pi.cat_status
       WHERE pi.enrollment_id = e.enrollment_id
         AND cs_pi.alias IN ('we_inst_paid', 'we_payment_status_paid')
    ) pay_agg ON TRUE
    LEFT JOIN LATERAL (
      SELECT amount FROM public.payment_installments
       WHERE enrollment_id = e.enrollment_id AND installment_number = 0
       LIMIT 1
    ) pi_res ON TRUE
    LEFT JOIN LATERAL (
      SELECT amount FROM public.payment_installments
       WHERE enrollment_id = e.enrollment_id AND installment_number = 1
       LIMIT 1
    ) pi_pt ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS cnt
        FROM public.payment_installments pi
        JOIN public."catalog" cs ON cs.catalog_id = pi.cat_status
       WHERE pi.enrollment_id = e.enrollment_id
         AND pi.installment_number > 0
         AND pi.due_date < CURRENT_DATE
         AND cs.alias NOT IN ('we_inst_paid', 'we_payment_status_paid')
    ) inst_overdue ON TRUE
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        l.pay_date,
        (SELECT py.payment_date::date FROM public.payments py
          WHERE py.enrollment_id = e.enrollment_id AND py.active = 'Y'
          ORDER BY py.payment_date ASC LIMIT 1),
        e.registration_date::date
      ) AS f_pago_date
    ) pay_eff ON TRUE
    ORDER BY pay_eff.f_pago_date NULLS LAST, e.enrollment_id
  `)
    return rows || []
  }

  // Pagos adicionales (certificado de becado): filas de payments sin cuota
  // asociada con tipo we_payment_type_certificate. Alimenta la hoja "Adicionales".
  async getFicoAdicionales () {
    const { rows } = await this.db.query(`
    SELECT
      COALESCE(pv.abbreviation, '')                        AS programa,
      to_char(p.payment_date, 'DD/MM/YYYY')                AS f_pago,
      TRIM(BOTH FROM concat_ws(' ', per.first_name, per.last_name, per.mother_last_name)) AS nombres,
      ${STUDENT_PHONE_SQL}                                                    AS celular,
      ${STUDENT_EMAIL_SQL}                                                    AS correo,
      replace(to_char(p.amount, 'FM999990.00'), '.', ',')  AS monto,
      COALESCE(NULLIF(c_curr.variable_3, ''), c_curr.description, '') AS tipo_moneda,
      COALESCE(cm.description, '')                         AS medio_pago,
      COALESCE(cb.description, '')                         AS entidad_empresa,
      COALESCE(ba.bank_name, '')                           AS entidad_financiera,
      COALESCE(p.transaction_code, '')                     AS n_operacion,
      CASE ct.alias
           WHEN 'we_payment_type_reassignment'       THEN 'REASIGNACIÓN'
           WHEN 'we_payment_type_course_change_diff' THEN 'PAGO DIFERENCIA POR CAMBIO DE CURSO'
           ELSE 'Cert. becas' END                            AS asunto,
      -- LINEA DE PRODUCTO: prefijo del version_code (mapeado) para adicionales no-certificado.
      -- ponytail: mapa minimo prefijo->linea FICO; extender si aparece otro.
      CASE WHEN ct.alias IN ('we_payment_type_reassignment', 'we_payment_type_course_change_diff')
           THEN CASE split_part(COALESCE(pv.version_code, ''), '-', 1)
                WHEN 'EX' THEN 'EXCEL'
                WHEN 'SA' THEN 'SAP'
                ELSE split_part(COALESCE(pv.version_code, ''), '-', 1) END
           ELSE '' END AS linea_producto
    FROM public.payments p
    JOIN public.enrollments e   ON e.enrollment_id = p.enrollment_id AND e.active = 'Y'
    JOIN public.customers cust  ON cust.customer_id = e.customer_id
    JOIN public.persons per     ON per.person_id = cust.person_id
    JOIN public."catalog" ct    ON ct.catalog_id = p.cat_payment_type
    LEFT JOIN public.leads l              ON l.enrollment_id = e.enrollment_id
    LEFT JOIN public.program_versions pv  ON pv.program_version_id = e.program_version_id
    LEFT JOIN public."catalog" c_curr     ON c_curr.catalog_id = e.cat_currency
    LEFT JOIN public."catalog" cm         ON cm.catalog_id = p.cat_method_payment
    LEFT JOIN public.bank_accounts ba     ON ba.account_id = p.settled_in_account_id
    LEFT JOIN public."catalog" cb         ON cb.catalog_id = ba.business_entity_catalog_id
    WHERE p.active = 'Y'
      AND p.installment_id IS NULL
      AND ct.alias IN ('we_payment_type_certificate', 'we_payment_type_reassignment', 'we_payment_type_course_change_diff')
    ORDER BY p.payment_date ASC, p.payment_id ASC
  `)
    return rows || []
  }

  // Ventas B2B (convenios) pagadas desde CONVENIOS_FROM_DATE. Alimenta la hoja
  // "7. Convenios". No aplica SYNC_FROM porque tiene su propio corte, pero si
  // EXCLUDE_IMPORTED: la importacion masiva tambien trae ventas con origen B2B
  // (39 de las 50 filas del 2026-08-25 eran importadas) y esas ya estan en la
  // hoja de origen.
  async getFicoConvenios () {
    const { rows } = await this.db.query(`
    SELECT
      to_char(l.registration_date, 'DD/MM/YYYY')           AS fecha,
      COALESCE(comp_lead.razon_social, comp_ctr.razon_social, l.company_name, '') AS empresa,
      TRIM(BOTH FROM concat_ws(' ', per.first_name, per.last_name, per.mother_last_name)) AS nombres,
      ${STUDENT_PHONE_SQL}                                                    AS numero,
      COALESCE(pv.abbreviation, '')                        AS nombre_p,
      to_char(pe.start_date, 'DD/MM/YYYY')                 AS f_programa,
      CASE c_prof.alias WHEN 'we_profile_student' THEN 'E' ELSE 'P' END AS ocup,
      to_char(pay_eff.f_pago_date, 'DD/MM/YYYY')           AS f_pago,
      CASE c_curr.alias WHEN 'we_currency_dollars' THEN 'USD' ELSE 'PEN' END AS moneda,
      replace(to_char(
        CASE WHEN inst_agg.cuotas > 0 THEN inst_agg.total ELSE e.total_amount END,
        'FM999990.00'), '.', ',')                          AS monto,
      CASE c_plan.alias
        WHEN 'we_payment_way_single'       THEN 'PT'
        WHEN 'we_payment_way_installments' THEN 'PP'
        ELSE ''
      END                                                  AS tipo_pago,
      CASE EXTRACT(MONTH FROM pay_eff.f_pago_date)
        WHEN 1 THEN 'ENE' WHEN 2 THEN 'FEB' WHEN 3 THEN 'MAR'
        WHEN 4 THEN 'ABR' WHEN 5 THEN 'MAY' WHEN 6 THEN 'JUN'
        WHEN 7 THEN 'JUL' WHEN 8 THEN 'AGO' WHEN 9 THEN 'SEP'
        WHEN 10 THEN 'OCT' WHEN 11 THEN 'NOV' WHEN 12 THEN 'DIC'
      END                                                  AS mes,
      EXTRACT(YEAR FROM pay_eff.f_pago_date)::text         AS anio,
      ${STUDENT_EMAIL_SQL}                                                    AS correo,
      replace(to_char(COALESCE(pay_agg.total_paid, 0), 'FM999990.00'), '.', ',') AS pago_efectuado,
      upper(COALESCE(c_type.description, ''))              AS tipo_program,
      COALESCE(c_mod.description, '')                      AS unidad,
      CASE
        WHEN e.agent_origin IS NOT NULL AND COALESCE(ag_token.alias, u.alias) IS NOT NULL
          THEN e.agent_origin || ' - ' || COALESCE(ag_token.alias, u.alias)
        ELSE COALESCE(ag_token.alias, u.alias, e.agent_origin, 'S/A')
      END                                                  AS asesor
    FROM public.enrollments e
    JOIN public.customers cust ON cust.customer_id = e.customer_id
    JOIN public.persons per    ON per.person_id = cust.person_id
    JOIN public."catalog" cf   ON cf.catalog_id = e.cat_fico_status
    LEFT JOIN public.leads l              ON l.enrollment_id = e.enrollment_id
    LEFT JOIN public.companies comp_lead  ON comp_lead.company_id = l.company_id
    LEFT JOIN public.b2b_contracts ctr    ON ctr.b2b_contract_id = e.b2b_contract_id
    LEFT JOIN public.companies comp_ctr   ON comp_ctr.company_id = ctr.company_id
    LEFT JOIN public.program_versions pv  ON pv.program_version_id = e.program_version_id
    LEFT JOIN public.programs prog        ON prog.program_id = pv.program_id
    LEFT JOIN public.program_editions pe  ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN public.users u              ON u.user_id = e.seller_agent_id
                                         AND ${NOT_FICO_OPERATOR('u')}
    LEFT JOIN public."catalog" c_prof     ON c_prof.catalog_id = e.cat_profile_id
    LEFT JOIN public."catalog" c_plan     ON c_plan.catalog_id = e.cat_payment_plan
    LEFT JOIN public."catalog" c_curr     ON c_curr.catalog_id = e.cat_currency
    LEFT JOIN public."catalog" c_type     ON c_type.catalog_id = prog.cat_type_program
    LEFT JOIN public."catalog" c_mod      ON c_mod.catalog_id = prog.cat_model_modality
    -- Asesor que solicito el PRIMER token de pago: el panel FICO lo prioriza
    -- sobre seller_agent_id y esta hoja tiene que decir lo mismo. En una venta
    -- por token el seller es quien genero el link (FICO/admin), no el comercial
    -- del convenio (18141 salia 'B2B - ELFI' donde el ERP muestra 'B2B - JF39').
    LEFT JOIN LATERAL (
      SELECT u_pt.alias
        FROM public.payment_tokens pt
        LEFT JOIN public.users u_pt ON u_pt.user_id = COALESCE(pt.requested_by, pt.created_by)
                                   AND ${NOT_FICO_OPERATOR('u_pt')}
       WHERE pt.enrollment_id = e.enrollment_id
       ORDER BY pt.token_id ASC
       LIMIT 1
    ) ag_token ON TRUE
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        l.pay_date::date,
        (SELECT py.payment_date::date FROM public.payments py
          WHERE py.enrollment_id = e.enrollment_id AND py.active = 'Y'
          ORDER BY py.payment_date ASC LIMIT 1),
        e.registration_date::date
      ) AS f_pago_date
    ) pay_eff ON TRUE
    LEFT JOIN LATERAL (
      -- Total segun las cuotas: es el precio vigente de la venta. Cuando FICO
      -- edita el precio, la edicion vive en las cuotas y enrollments.total_amount
      -- se queda con el valor viejo (16394: total 410, cuotas 80+248 = 328). La
      -- ficha del alumno muestra el 328 y la hoja tiene que decir lo mismo.
      SELECT COUNT(*)::int AS cuotas, COALESCE(SUM(pi.amount), 0) AS total
        FROM public.payment_installments pi
       WHERE pi.enrollment_id = e.enrollment_id
    ) inst_agg ON TRUE
    LEFT JOIN LATERAL (
      -- Mismo criterio que la hoja de ventas: lo cobrado son las cuotas
      -- marcadas como pagadas, no las filas de payments (que se duplican).
      SELECT COALESCE(SUM(pi.amount), 0) AS total_paid
        FROM public.payment_installments pi
        JOIN public."catalog" cs_pi ON cs_pi.catalog_id = pi.cat_status
       WHERE pi.enrollment_id = e.enrollment_id
         AND cs_pi.alias IN ('we_inst_paid', 'we_payment_status_paid')
    ) pay_agg ON TRUE
    WHERE e.active = 'Y'
      AND cf.alias = 'we_enrollment_status_checked'
      ${IS_B2B}
      ${PARENT_OR_CC_DESTINATION}
      ${EXCLUDE_IMPORTED}
      ${EXCLUDE_UNCOLLECTED}
      AND pay_eff.f_pago_date >= DATE '${CONVENIOS_FROM_DATE}'
    ORDER BY pay_eff.f_pago_date, e.enrollment_id
  `)
    return rows || []
  }

  async getFicoAula () {
    const { rows } = await this.db.query(`
    WITH approved AS (
      SELECT e.enrollment_id
        FROM public.enrollments e
        JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
       WHERE cf.alias = 'we_enrollment_status_checked'
         AND e.active = 'Y'
         -- HOJA = sin hijos (un destino de CC hacia paquete tiene padre Y
         -- hijos: asisten sus hijos SEG, no el).
         AND NOT EXISTS (SELECT 1 FROM public.enrollments c WHERE c.parent_enrollment_id = e.enrollment_id)
         ${EXCLUDE_IMPORTED}
         ${EXCLUDE_UNCOLLECTED}
         ${SYNC_FROM}
    ),
    -- Ver nota en getFicoSales: fallback de momento de cliente por telefono
    -- contra public.consolidated cuando el lead no lo tiene asignado.
    hist AS (
      SELECT co.phone,
             BOOL_OR(cm_h.alias = 'we_moment_cwd') AS has_cwd
        FROM public.consolidated co
        LEFT JOIN public."catalog" cm_h ON cm_h.catalog_id = co.cat_client_moment
       WHERE co.phone IS NOT NULL AND co.phone <> ''
       GROUP BY co.phone
    )
    SELECT
      pv.version_code                                      AS curso,
      COALESCE(pv_parent.version_code, '')                 AS catg,
      to_char(pe.start_date, 'DD/MM/YYYY')                 AS f_inicio,
      COALESCE(per.document_number, '')                    AS dni,
      TRIM(BOTH FROM concat_ws(' ', per.first_name, per.last_name, per.mother_last_name)) AS nombres,
      phone_eff.phone                                      AS celular,
      ${STUDENT_EMAIL_SQL}                                                    AS correo,
      CASE c_prof.alias
        WHEN 'we_profile_student' THEN 'E'
        ELSE 'P'
      END                                                  AS ocup,
      CASE
        WHEN e.agent_origin IS NOT NULL AND COALESCE(ag_token.alias, u.alias) IS NOT NULL
          THEN e.agent_origin || ' - ' || COALESCE(ag_token.alias, u.alias)
        ELSE COALESCE(ag_token.alias, u.alias, e.agent_origin, 'S/A')
      END AS asesor,
      'ACT'                                                AS estado_alumno,
      CASE
        WHEN COALESCE(pay_agg.total_paid, 0) >= (e.total_amount) THEN 'Saldado'
        WHEN inst_overdue.cnt > 0 THEN 'Deuda ' || inst_overdue.cnt::text
        ELSE 'Al dia'
      END                                                  AS al_dia,
      replace(to_char(GREATEST(0, (e.total_amount) - COALESCE(pay_agg.total_paid, 0)), 'FM999990.00'), '.', ',') AS saldo,
      CASE c_plan.alias
        WHEN 'we_payment_way_single'        THEN 'PT'
        WHEN 'we_payment_way_installments'  THEN 'PP'
        ELSE ''
      END                                                  AS estado_pago,
      CASE
        WHEN COALESCE(e.list_price, 0) = 0 THEN ''
        ELSE replace(to_char(ROUND(e.discount_amount / e.list_price * 100, 1), 'FM999990.0'), '.', ',') || '%'
      END                                                  AS descuento,
      CASE
        WHEN COALESCE(c_moment.variable_2, '') <> '' THEN c_moment.variable_2
        WHEN hist.has_cwd THEN 'CWE'
        WHEN hist.phone IS NOT NULL THEN 'LDS'
        ELSE 'NEW'
      END                                                  AS tipo_cliente,
      -- ES MEMBER: mismo criterio que la hoja de ventas; los hijos de paquete
      -- heredan el tier del padre (el hijo no repite membership_program_id).
      CASE WHEN COALESCE(prog.is_membership, false) THEN COALESCE(pv.abbreviation, '')
           ELSE COALESCE(mtier.abbreviation, '')
      END AS es_member
    FROM public.enrollments e
    JOIN approved a ON a.enrollment_id = e.enrollment_id
    JOIN public.customers cust ON cust.customer_id = e.customer_id
    JOIN public.persons per   ON per.person_id   = cust.person_id
    LEFT JOIN public.leads l            ON l.enrollment_id = e.enrollment_id
    LEFT JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN public.programs prog       ON prog.program_id = pv.program_id
    LEFT JOIN public.program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN public.users u             ON u.user_id = e.seller_agent_id
    LEFT JOIN public."catalog" c_prof    ON c_prof.catalog_id = e.cat_profile_id
    LEFT JOIN public."catalog" c_plan    ON c_plan.catalog_id = e.cat_payment_plan
    LEFT JOIN public."catalog" c_moment  ON c_moment.catalog_id = l.cat_client_moment
    LEFT JOIN public.enrollments e_parent ON e_parent.enrollment_id = e.parent_enrollment_id
    LEFT JOIN public.program_versions pv_parent ON pv_parent.program_version_id = e_parent.program_version_id
    LEFT JOIN LATERAL (
      SELECT pv_m.abbreviation
        FROM public.program_versions pv_m
       WHERE pv_m.program_id = COALESCE(e.membership_program_id, e_parent.membership_program_id)
         AND pv_m.active = 'Y'
       ORDER BY pv_m.program_version_id DESC
       LIMIT 1
    ) mtier ON TRUE
    LEFT JOIN LATERAL (
      SELECT ${STUDENT_PHONE_SQL} AS phone
    ) phone_eff ON TRUE
    LEFT JOIN hist ON hist.phone = phone_eff.phone
    LEFT JOIN LATERAL (
      SELECT u_pt.alias
        FROM public.payment_tokens pt
        LEFT JOIN public.users u_pt ON u_pt.user_id = COALESCE(pt.requested_by, pt.created_by)
       WHERE pt.enrollment_id = e.enrollment_id
       ORDER BY pt.token_id ASC
       LIMIT 1
    ) ag_token ON TRUE
    LEFT JOIN LATERAL (
      -- Ver nota en syncFicoSalesToSheet: sumamos monto de cuotas saldadas
      -- (cat_status = paid) en lugar de SUM de payments, porque payments
      -- puede contener filas duplicadas que distorsionan el total.
      SELECT COALESCE(SUM(pi.amount), 0) AS total_paid
        FROM public.payment_installments pi
        JOIN public."catalog" cs_pi ON cs_pi.catalog_id = pi.cat_status
       WHERE pi.enrollment_id = e.enrollment_id
         AND cs_pi.alias IN ('we_inst_paid', 'we_payment_status_paid')
    ) pay_agg ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS cnt
        FROM public.payment_installments pi
        JOIN public."catalog" cs ON cs.catalog_id = pi.cat_status
       WHERE pi.enrollment_id = e.enrollment_id
         AND pi.installment_number > 0
         AND pi.due_date < CURRENT_DATE
         AND cs.alias NOT IN ('we_inst_paid', 'we_payment_status_paid')
    ) inst_overdue ON TRUE
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        l.pay_date,
        (SELECT py.payment_date::date FROM public.payments py
          WHERE py.enrollment_id = e.enrollment_id AND py.active = 'Y'
          ORDER BY py.payment_date ASC LIMIT 1),
        e.registration_date::date
      ) AS f_pago_date
    ) pay_eff ON TRUE
    ORDER BY pay_eff.f_pago_date NULLS LAST, pe.start_date NULLS LAST, per.last_name
  `)
    return rows || []
  }

  // Membresias vigentes vendidas (WE PLUS / GOLD / PLAT / BLACK) con el dia en
  // que se les retira el beneficio: un anio exacto desde que arranco.
  //
  // Arranque = membership_activation_date cuando la activacion se difirio (la
  // fija el flujo de confirmacion de pago, hoy solo un punado de casos) y, si no,
  // la F. PAGO efectiva, la misma fecha que usan las demas hojas FICO.
  //
  // A diferencia de las otras hojas, esta NO aplica EXCLUDE_IMPORTED ni SYNC_FROM:
  // la mitad de las membresias entro por la importacion masiva y un tercio es
  // anterior al corte del sync, y todas siguen dando beneficio. Filtrarlas
  // dejaria la hoja mintiendo sobre quien tiene membresia activa.
  async getFicoMembresias () {
    const { rows } = await this.db.query(`
    SELECT
      TRIM(BOTH FROM COALESCE(per.first_name, ''))                          AS nombres,
      TRIM(BOTH FROM concat_ws(' ', per.last_name, per.mother_last_name))   AS apellidos,
      ${STUDENT_PHONE_SQL} AS celular,
      ${STUDENT_EMAIL_SQL} AS correo,
      COALESCE(pv.abbreviation, pv.version_code, '')                        AS membresia,
      to_char(inicio.f + INTERVAL '1 year', 'DD/MM/YYYY')                   AS vencimiento
    FROM public.enrollments e
    JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
                            AND cf.alias = 'we_enrollment_status_checked'
    JOIN public.customers cust ON cust.customer_id = e.customer_id
    JOIN public.persons per    ON per.person_id    = cust.person_id
    JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
    JOIN public.programs prog       ON prog.program_id = pv.program_id
                                   AND prog.is_membership = true
    LEFT JOIN public.leads l ON l.enrollment_id = e.enrollment_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        e.membership_activation_date,
        l.pay_date,
        (SELECT py.payment_date::date FROM public.payments py
          WHERE py.enrollment_id = e.enrollment_id AND py.active = 'Y'
          ORDER BY py.payment_date ASC LIMIT 1),
        e.registration_date::date
      ) AS f
    ) inicio ON TRUE
    WHERE e.active = 'Y'
      ${EXCLUDE_UNCOLLECTED}
    ORDER BY inicio.f DESC, per.last_name
  `)
    return rows || []
  }

  // Ventas de eventos/congresos confirmadas por FICO, para la hoja
  // "4. Ventas Eventos". Mismos filtros que las otras hojas de venta (solo
  // verificadas, sin la importacion masiva ni las retenidas, desde el corte),
  // acotadas a inscripciones de evento. NOMBRES y APELLIDOS van separados: la
  // hoja los usa como columnas distintas, a diferencia de Ventas/Consolidado.
  //
  // UNICA hoja que NO aplica EXCLUDE_UNCOLLECTED_SERVICE_ORDER: la entrada
  // vendida contra Orden de Compra/Servicio todavia no cobrada tiene que
  // aparecer aqui igual, porque el evento se organiza con esa persona sentada
  // en la sala aunque la empresa deposite despues. La columna STATUS ya la
  // distingue: sin pagos el saldo es el total, asi que sale DEBE, y pasa a
  // NO DEBE sola cuando FICO registra el cobro -- que es tambien el momento en
  // que entra al resto de hojas. EXCLUDE_HELD si se respeta: esa lista es una
  // retencion decidida a mano, no una espera de cobranza.
  async getFicoEventos () {
    const { rows } = await this.db.query(`
    WITH approved AS (
      SELECT e.enrollment_id
        FROM public.enrollments e
        JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
       WHERE cf.alias = 'we_enrollment_status_checked'
         AND e.active = 'Y'
         ${PARENT_OR_CC_DESTINATION}
         ${EXCLUDE_IMPORTED}
         ${EXCLUDE_HELD}
         ${SYNC_FROM}
         ${IS_EVENT}
    )
    SELECT
      to_char(
        COALESCE(
          l.pay_date,
          first_pay.payment_date::date,
          e.registration_date::date
        ),
        'DD/MM/YYYY'
      ) AS f_pago,
      per.document_number AS dni,
      TRIM(BOTH FROM COALESCE(per.first_name, ''))                        AS nombres,
      TRIM(BOTH FROM concat_ws(' ', per.last_name, per.mother_last_name)) AS apellidos,
      ${STUDENT_PHONE_SQL} AS celular,
      ${STUDENT_EMAIL_SQL} AS correo,
      CASE c_prof.alias
        WHEN 'we_profile_student' THEN 'E'
        ELSE 'P'
      END AS ocup,
      CASE
        WHEN (e.total_amount) = 0 THEN 'BECA'
        WHEN c_plan.alias = 'we_payment_way_single'       THEN 'PT'
        WHEN c_plan.alias = 'we_payment_way_installments' THEN 'PP'
        ELSE ''
      END AS estado,
      CASE
        WHEN COALESCE(e.list_price, 0) = 0 THEN ''
        ELSE replace(to_char(ROUND(e.discount_amount / e.list_price * 100, 2), 'FM999990.00'), '.', ',') || '%'
      END AS dsct,
      -- La entrada de un evento se paga de una: la INICIAL es la cuota 1 (o el
      -- total si no se registro cuota). Un evento en cuotas caeria en la rama
      -- de la reserva, igual que en la hoja Consolidado.
      CASE
        WHEN (e.total_amount) = 0 THEN '0'
        WHEN c_plan.alias = 'we_payment_way_installments'
          THEN replace(to_char(COALESCE(pi_res.amount, 0), 'FM999990.00'), '.', ',')
        ELSE replace(to_char(COALESCE(pi_pt.amount, e.total_amount), 'FM999990.00'), '.', ',')
      END AS inicial,
      CASE
        WHEN (e.total_amount) = 0 THEN '0'
        ELSE replace(to_char(GREATEST(0, (e.total_amount) - COALESCE(pay_agg.total_paid, 0)), 'FM999990.00'), '.', ',')
      END AS saldo,
      CASE
        WHEN (e.total_amount) = 0 THEN '0'
        ELSE replace(to_char(COALESCE(pay_agg.total_paid, 0), 'FM999990.00'), '.', ',')
      END AS ingreso,
      -- STATUS de cobranza: DEBE mientras quede saldo. Una beca (total 0) o una
      -- entrada pagada completa nunca deben.
      CASE
        WHEN (e.total_amount) = 0 THEN 'NO DEBE'
        WHEN GREATEST(0, (e.total_amount) - COALESCE(pay_agg.total_paid, 0)) > 0 THEN 'DEBE'
        ELSE 'NO DEBE'
      END AS status_deuda,
      COALESCE(c_ev.description, '') AS modalidad,
      COALESCE(e.event_seat, '')     AS asiento,
      COALESCE(pv.version_code, '')  AS cod
    FROM public.enrollments e
    JOIN approved a ON a.enrollment_id = e.enrollment_id
    JOIN public.customers cust ON cust.customer_id = e.customer_id
    JOIN public.persons per   ON per.person_id   = cust.person_id
    LEFT JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN public.leads l          ON l.enrollment_id = e.enrollment_id
    LEFT JOIN public."catalog" c_prof ON c_prof.catalog_id = e.cat_profile_id
    LEFT JOIN public."catalog" c_plan ON c_plan.catalog_id = e.cat_payment_plan
    LEFT JOIN public."catalog" c_ev   ON c_ev.catalog_id   = e.cat_event_category
    LEFT JOIN LATERAL (
      -- Ver nota en getFicoSales: el total pagado se suma de las cuotas
      -- saldadas, no de payments, que puede traer filas duplicadas.
      SELECT COALESCE(SUM(pi.amount), 0) AS total_paid
        FROM public.payment_installments pi
        JOIN public."catalog" cs_pi ON cs_pi.catalog_id = pi.cat_status
       WHERE pi.enrollment_id = e.enrollment_id
         AND cs_pi.alias IN ('we_inst_paid', 'we_payment_status_paid')
    ) pay_agg ON TRUE
    LEFT JOIN LATERAL (
      SELECT amount FROM public.payment_installments
       WHERE enrollment_id = e.enrollment_id AND installment_number = 0
       LIMIT 1
    ) pi_res ON TRUE
    LEFT JOIN LATERAL (
      SELECT amount FROM public.payment_installments
       WHERE enrollment_id = e.enrollment_id AND installment_number = 1
       LIMIT 1
    ) pi_pt ON TRUE
    LEFT JOIN LATERAL (
      SELECT p.payment_date FROM public.payments p
       WHERE p.enrollment_id = e.enrollment_id AND p.active = 'Y'
       ORDER BY p.payment_id ASC LIMIT 1
    ) first_pay ON TRUE
    ORDER BY COALESCE(l.pay_date, first_pay.payment_date::date, e.registration_date::date) NULLS LAST, e.enrollment_id
  `)
    return rows || []
  }

  async getFicoConsolidado () {
    const { rows } = await this.db.query(`
    WITH approved AS (
      SELECT e.enrollment_id
        FROM public.enrollments e
        JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
       WHERE cf.alias = 'we_enrollment_status_checked'
         AND e.active = 'Y'
         ${PARENT_OR_CC_DESTINATION}
         ${EXCLUDE_IMPORTED}
         ${EXCLUDE_UNCOLLECTED}
         ${SYNC_FROM}
    )
    SELECT
      pv.version_code AS cod,
      CASE WHEN e.program_edition_id IS NULL THEN 'E0'
           ELSE COALESCE(pe.global_code, '')
      END AS ed,
      to_char(pe.start_date, 'DD/MM/YYYY') AS f_inicio,
      to_char(
        COALESCE(
          l.pay_date,
          first_pay.payment_date::date,
          e.registration_date::date
        ),
        'DD/MM/YYYY'
      ) AS f_pago,
      per.document_number AS dni,
      TRIM(BOTH FROM concat_ws(' ', per.first_name, per.last_name, per.mother_last_name)) AS nombres,
      ${STUDENT_PHONE_SQL} AS celular,
      ${STUDENT_EMAIL_SQL} AS correo,
      CASE c_prof.alias
        WHEN 'we_profile_student' THEN 'E'
        ELSE 'P'
      END AS ocup,
      CASE
        WHEN e.agent_origin IS NOT NULL AND COALESCE(ag_token.alias, u.alias) IS NOT NULL
          THEN e.agent_origin || ' - ' || COALESCE(ag_token.alias, u.alias)
        ELSE COALESCE(ag_token.alias, u.alias, e.agent_origin, 'S/A')
      END AS asesor,
      CASE
        WHEN (e.total_amount) = 0 THEN 'BECA'
        WHEN c_plan.alias = 'we_payment_way_single'       THEN 'PT'
        WHEN c_plan.alias = 'we_payment_way_installments' THEN 'PP'
        ELSE ''
      END AS estado,
      CASE
        WHEN COALESCE(e.list_price, 0) = 0 THEN ''
        ELSE replace(to_char(ROUND(e.discount_amount / e.list_price * 100, 2), 'FM999990.00'), '.', ',') || '%'
      END AS dsct,
      CASE
        WHEN (e.total_amount) = 0 THEN 'Saldado'
        WHEN COALESCE(pay_agg.total_paid, 0) >= (e.total_amount) THEN 'Saldado'
        WHEN inst_overdue.cnt > 0 THEN 'Deuda ' || inst_overdue.cnt::text
        ELSE 'Al dia'
      END AS status_pago,
      CASE
        WHEN (e.total_amount) = 0 THEN '0'
        WHEN c_plan.alias = 'we_payment_way_single'
          THEN replace(to_char(COALESCE(pi_pt.amount, e.total_amount), 'FM999990.00'), '.', ',')
        WHEN c_plan.alias = 'we_payment_way_installments'
          THEN replace(to_char(COALESCE(pi_res.amount, 0), 'FM999990.00'), '.', ',')
        ELSE '0'
      END AS inicial,
      CASE WHEN c_plan.alias = 'we_payment_way_installments' AND cuotas.c1_due IS NOT NULL
           THEN to_char(COALESCE(CASE WHEN cuotas.c1_paid THEN cuotas.c1_pay_date END, cuotas.c1_due), 'DD/MM/YYYY')
           ELSE '' END AS fc1,
      CASE WHEN c_plan.alias = 'we_payment_way_installments' AND cuotas.c1_paid
           THEN replace(to_char(cuotas.c1_amount, 'FM999990.00'), '.', ',') ELSE '' END AS c1,
      CASE WHEN c_plan.alias = 'we_payment_way_installments' AND cuotas.c2_due IS NOT NULL
           THEN to_char(COALESCE(CASE WHEN cuotas.c2_paid THEN cuotas.c2_pay_date END, cuotas.c2_due), 'DD/MM/YYYY')
           ELSE '' END AS fc2,
      CASE WHEN c_plan.alias = 'we_payment_way_installments' AND cuotas.c2_paid
           THEN replace(to_char(cuotas.c2_amount, 'FM999990.00'), '.', ',') ELSE '' END AS c2,
      CASE WHEN c_plan.alias = 'we_payment_way_installments' AND cuotas.c3_due IS NOT NULL
           THEN to_char(COALESCE(CASE WHEN cuotas.c3_paid THEN cuotas.c3_pay_date END, cuotas.c3_due), 'DD/MM/YYYY')
           ELSE '' END AS fc3,
      CASE WHEN c_plan.alias = 'we_payment_way_installments' AND cuotas.c3_paid
           THEN replace(to_char(cuotas.c3_amount, 'FM999990.00'), '.', ',') ELSE '' END AS c3,
      CASE WHEN c_plan.alias = 'we_payment_way_installments' AND cuotas.c4_due IS NOT NULL
           THEN to_char(COALESCE(CASE WHEN cuotas.c4_paid THEN cuotas.c4_pay_date END, cuotas.c4_due), 'DD/MM/YYYY')
           ELSE '' END AS fc4,
      CASE WHEN c_plan.alias = 'we_payment_way_installments' AND cuotas.c4_paid
           THEN replace(to_char(cuotas.c4_amount, 'FM999990.00'), '.', ',') ELSE '' END AS c4,
      CASE WHEN c_plan.alias = 'we_payment_way_installments' AND cuotas.c5_due IS NOT NULL
           THEN to_char(COALESCE(CASE WHEN cuotas.c5_paid THEN cuotas.c5_pay_date END, cuotas.c5_due), 'DD/MM/YYYY')
           ELSE '' END AS fc5,
      CASE WHEN c_plan.alias = 'we_payment_way_installments' AND cuotas.c5_paid
           THEN replace(to_char(cuotas.c5_amount, 'FM999990.00'), '.', ',') ELSE '' END AS c5,
      CASE
        WHEN (e.total_amount) = 0 THEN '0'
        ELSE replace(to_char(GREATEST(0, (e.total_amount) - COALESCE(pay_agg.total_paid, 0)), 'FM999990.00'), '.', ',')
      END AS saldo,
      CASE
        WHEN (e.total_amount) = 0 THEN '0'
        ELSE replace(to_char(COALESCE(pay_agg.total_paid, 0), 'FM999990.00'), '.', ',')
      END AS ingreso,
      CASE WHEN (e.total_amount) = 0 THEN ''
           ELSE CASE
                  WHEN curr.alias = 'we_currency_soles' THEN 'PEN'
                  WHEN curr.alias = 'we_currency_usd'   THEN 'USD'
                  -- Fallback por simbolo: cubre enrollments viejos con aliases
                  -- typo en BD (we_currency_dolares/dollars) que el codigo dejo
                  -- de generar el 2026-05-18 pero que pueden seguir en catalog.
                  WHEN curr.variable_2 = '$'            THEN 'USD'
                  WHEN curr.variable_2 IN ('S/', 'S/.') THEN 'PEN'
                  ELSE COALESCE(curr.variable_2, '')
                END
           END AS tipo_moneda,
      CASE WHEN (e.total_amount) = 0 THEN ''
           ELSE COALESCE(c_meth.description, '') END AS medio_pago,
      CASE WHEN (e.total_amount) = 0 THEN ''
           ELSE COALESCE(c_be.description, '') END AS entidad_empresa,
      CASE WHEN (e.total_amount) = 0 THEN ''
           ELSE COALESCE(ba.bank_name, '') END AS entidad_financiera,
      CASE WHEN (e.total_amount) = 0 THEN ''
           ELSE COALESCE(first_pay.transaction_code, '') END AS n_operacion
    FROM public.enrollments e
    JOIN approved a ON a.enrollment_id = e.enrollment_id
    JOIN public.customers cust ON cust.customer_id = e.customer_id
    JOIN public.persons per   ON per.person_id   = cust.person_id
    LEFT JOIN public.leads l            ON l.enrollment_id = e.enrollment_id
    LEFT JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN public.program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN public.users u             ON u.user_id = e.seller_agent_id
    LEFT JOIN public."catalog" c_prof    ON c_prof.catalog_id = e.cat_profile_id
    LEFT JOIN public."catalog" c_plan    ON c_plan.catalog_id = e.cat_payment_plan
    LEFT JOIN public."catalog" curr      ON curr.catalog_id   = e.cat_currency
    LEFT JOIN LATERAL (
      SELECT u_pt.alias
        FROM public.payment_tokens pt
        LEFT JOIN public.users u_pt ON u_pt.user_id = COALESCE(pt.requested_by, pt.created_by)
       WHERE pt.enrollment_id = e.enrollment_id
       ORDER BY pt.token_id ASC
       LIMIT 1
    ) ag_token ON TRUE
    LEFT JOIN LATERAL (
      -- Ver nota en syncFicoSalesToSheet: sumamos monto de cuotas saldadas
      -- (cat_status = paid) en lugar de SUM de payments, porque payments
      -- puede contener filas duplicadas que distorsionan el total.
      SELECT COALESCE(SUM(pi.amount), 0) AS total_paid
        FROM public.payment_installments pi
        JOIN public."catalog" cs_pi ON cs_pi.catalog_id = pi.cat_status
       WHERE pi.enrollment_id = e.enrollment_id
         AND cs_pi.alias IN ('we_inst_paid', 'we_payment_status_paid')
    ) pay_agg ON TRUE
    LEFT JOIN LATERAL (
      SELECT amount FROM public.payment_installments
       WHERE enrollment_id = e.enrollment_id AND installment_number = 0
       LIMIT 1
    ) pi_res ON TRUE
    LEFT JOIN LATERAL (
      SELECT amount FROM public.payment_installments
       WHERE enrollment_id = e.enrollment_id AND installment_number = 1
       LIMIT 1
    ) pi_pt ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS cnt
        FROM public.payment_installments pi
        JOIN public."catalog" cs ON cs.catalog_id = pi.cat_status
       WHERE pi.enrollment_id = e.enrollment_id
         AND pi.installment_number > 0
         AND pi.due_date < CURRENT_DATE
         AND cs.alias NOT IN ('we_inst_paid', 'we_payment_status_paid')
    ) inst_overdue ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        p.payment_date, p.transaction_code,
        p.cat_method_payment, p.settled_in_account_id
      FROM public.payments p
      WHERE p.enrollment_id = e.enrollment_id AND p.active = 'Y'
      ORDER BY p.payment_id ASC
      LIMIT 1
    ) first_pay ON TRUE
    LEFT JOIN public.bank_accounts ba ON ba.account_id = first_pay.settled_in_account_id
    LEFT JOIN public."catalog" c_meth ON c_meth.catalog_id = first_pay.cat_method_payment
    LEFT JOIN public."catalog" c_be   ON c_be.catalog_id = ba.business_entity_catalog_id
    LEFT JOIN LATERAL (
      -- Para cada cuota 1..5 devolvemos due_date (siempre que la cuota exista),
      -- pay_date (solo si fue pagada) y un flag c{N}_paid. La fecha de pago real
      -- gana sobre la fecha de vencimiento cuando la cuota ya esta pagada.
      -- Excluimos anuladas para que no aparezcan como cuota fantasma.
      SELECT
        MAX(CASE WHEN pi.installment_number = 1 THEN pi.due_date END) AS c1_due,
        MAX(CASE WHEN pi.installment_number = 1 AND cs.alias IN ('we_inst_paid','we_payment_status_paid') THEN p.payment_date::date END) AS c1_pay_date,
        MAX(CASE WHEN pi.installment_number = 1 THEN pi.amount END)   AS c1_amount,
        BOOL_OR(pi.installment_number = 1 AND cs.alias IN ('we_inst_paid','we_payment_status_paid')) AS c1_paid,
        MAX(CASE WHEN pi.installment_number = 2 THEN pi.due_date END) AS c2_due,
        MAX(CASE WHEN pi.installment_number = 2 AND cs.alias IN ('we_inst_paid','we_payment_status_paid') THEN p.payment_date::date END) AS c2_pay_date,
        MAX(CASE WHEN pi.installment_number = 2 THEN pi.amount END)   AS c2_amount,
        BOOL_OR(pi.installment_number = 2 AND cs.alias IN ('we_inst_paid','we_payment_status_paid')) AS c2_paid,
        MAX(CASE WHEN pi.installment_number = 3 THEN pi.due_date END) AS c3_due,
        MAX(CASE WHEN pi.installment_number = 3 AND cs.alias IN ('we_inst_paid','we_payment_status_paid') THEN p.payment_date::date END) AS c3_pay_date,
        MAX(CASE WHEN pi.installment_number = 3 THEN pi.amount END)   AS c3_amount,
        BOOL_OR(pi.installment_number = 3 AND cs.alias IN ('we_inst_paid','we_payment_status_paid')) AS c3_paid,
        MAX(CASE WHEN pi.installment_number = 4 THEN pi.due_date END) AS c4_due,
        MAX(CASE WHEN pi.installment_number = 4 AND cs.alias IN ('we_inst_paid','we_payment_status_paid') THEN p.payment_date::date END) AS c4_pay_date,
        MAX(CASE WHEN pi.installment_number = 4 THEN pi.amount END)   AS c4_amount,
        BOOL_OR(pi.installment_number = 4 AND cs.alias IN ('we_inst_paid','we_payment_status_paid')) AS c4_paid,
        MAX(CASE WHEN pi.installment_number = 5 THEN pi.due_date END) AS c5_due,
        MAX(CASE WHEN pi.installment_number = 5 AND cs.alias IN ('we_inst_paid','we_payment_status_paid') THEN p.payment_date::date END) AS c5_pay_date,
        MAX(CASE WHEN pi.installment_number = 5 THEN pi.amount END)   AS c5_amount,
        BOOL_OR(pi.installment_number = 5 AND cs.alias IN ('we_inst_paid','we_payment_status_paid')) AS c5_paid
      FROM public.payment_installments pi
      JOIN public."catalog" cs ON cs.catalog_id = pi.cat_status
      LEFT JOIN public.payments p ON p.installment_id = pi.installment_id AND p.active = 'Y'
      WHERE pi.enrollment_id = e.enrollment_id
        AND pi.installment_number BETWEEN 1 AND 5
        AND cs.alias <> 'we_inst_cancelled'
    ) cuotas ON TRUE
    ORDER BY COALESCE(l.pay_date, first_pay.payment_date::date, e.registration_date::date) NULLS LAST, e.enrollment_id
  `)
    return rows || []
  }

  async getFicoCuotas () {
    const { rows } = await this.db.query(`
    WITH approved AS (
      SELECT e.enrollment_id
        FROM public.enrollments e
        JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
       WHERE cf.alias = 'we_enrollment_status_checked'
         AND e.active = 'Y'
         ${PARENT_OR_CC_DESTINATION}
         ${EXCLUDE_IMPORTED}
         ${EXCLUDE_UNCOLLECTED}
         ${SYNC_FROM}
    )
    SELECT
      e.enrollment_id,
      pv.version_code AS cod,
      CASE WHEN e.program_edition_id IS NULL THEN 'E0'
           ELSE COALESCE(pe.global_code, '')
      END AS ed,
      to_char(pe.start_date, 'DD/MM/YYYY') AS f_inicio,
      TRIM(BOTH FROM concat_ws(' ', per.first_name, per.last_name, per.mother_last_name)) AS nombres,
      ${STUDENT_PHONE_SQL} AS celular,
      ${STUDENT_EMAIL_SQL} AS correo,
      CASE c_prof.alias
        WHEN 'we_profile_student' THEN 'E'
        ELSE 'P'
      END AS ocup,
      CASE
        WHEN e.agent_origin IS NOT NULL AND COALESCE(ag_token.alias, u.alias) IS NOT NULL
          THEN e.agent_origin || ' - ' || COALESCE(ag_token.alias, u.alias)
        ELSE COALESCE(ag_token.alias, u.alias, e.agent_origin, 'S/A')
      END AS asesor,
      CASE
        WHEN COALESCE(pay_agg.total_paid, 0) >= e.total_amount THEN 'Saldado'
        WHEN inst_overdue.cnt > 0 THEN 'Deuda ' || inst_overdue.cnt::text
        ELSE 'Al dia'
      END AS estado,
      CASE
        WHEN curr.alias = 'we_currency_soles' THEN 'PEN'
        WHEN curr.alias = 'we_currency_usd'   THEN 'USD'
        -- Ver nota en syncFicoConsolidadoToSheet: aliases typo (dolares/dollars)
        -- escapan los WHEN explicitos y caen al simbolo. Mapeamos por simbolo
        -- como segunda capa hasta que el catalog en BD quede canonizado.
        WHEN curr.variable_2 = '$'            THEN 'USD'
        WHEN curr.variable_2 IN ('S/', 'S/.') THEN 'PEN'
        ELSE COALESCE(curr.variable_2, '')
      END AS moneda,
      (
        SELECT jsonb_agg(cuota_row ORDER BY cuota_row.num ASC)
        FROM (
          SELECT
            pi.installment_number AS num,
            CASE WHEN cs.alias IN ('we_inst_paid', 'we_payment_status_paid') AND p.payment_date IS NOT NULL
                 THEN to_char(p.payment_date, 'DD/MM/YYYY')
                 ELSE to_char(pi.due_date, 'DD/MM/YYYY')
            END AS fc,
            CASE WHEN cs.alias IN ('we_inst_paid', 'we_payment_status_paid')
                 THEN replace(to_char(pi.amount, 'FM999990.00'), '.', ',')
                 ELSE ''
            END AS monto,
            CASE WHEN cs.alias IN ('we_inst_paid', 'we_payment_status_paid')
                 THEN COALESCE(c_meth.description, '')
                 ELSE ''
            END AS medio_pago,
            CASE WHEN cs.alias IN ('we_inst_paid', 'we_payment_status_paid')
                 THEN COALESCE(c_be.description, '')
                 ELSE ''
            END AS entidad_empresa,
            CASE WHEN cs.alias IN ('we_inst_paid', 'we_payment_status_paid')
                 THEN COALESCE(ba.bank_name, '')
                 ELSE ''
            END AS entidad_financiera,
            CASE WHEN cs.alias IN ('we_inst_paid', 'we_payment_status_paid')
                 THEN COALESCE(p.transaction_code, '')
                 ELSE ''
            END AS n_operacion,
            to_char(pi.due_date, 'DD/MM/YYYY') AS fc_proyeccion,
            replace(to_char(pi.amount, 'FM999990.00'), '.', ',') AS monto_proyeccion
          FROM public.payment_installments pi
          JOIN public."catalog" cs ON cs.catalog_id = pi.cat_status
          LEFT JOIN public.payments p     ON p.installment_id = pi.installment_id AND p.active = 'Y'
          LEFT JOIN public.bank_accounts ba ON ba.account_id = p.settled_in_account_id
          LEFT JOIN public."catalog" c_meth ON c_meth.catalog_id = p.cat_method_payment
          LEFT JOIN public."catalog" c_be   ON c_be.catalog_id = ba.business_entity_catalog_id
          WHERE pi.enrollment_id = e.enrollment_id
            AND pi.installment_number > 0
            AND cs.alias <> 'we_inst_cancelled'
        ) cuota_row
      ) AS cuotas_json
    FROM public.enrollments e
    JOIN approved a ON a.enrollment_id = e.enrollment_id
    JOIN public.customers cust ON cust.customer_id = e.customer_id
    JOIN public.persons per   ON per.person_id   = cust.person_id
    LEFT JOIN public.leads l            ON l.enrollment_id = e.enrollment_id
    LEFT JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN public.program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN public.users u             ON u.user_id = e.seller_agent_id
    LEFT JOIN public."catalog" c_prof    ON c_prof.catalog_id = e.cat_profile_id
    LEFT JOIN public."catalog" c_plan    ON c_plan.catalog_id = e.cat_payment_plan
    LEFT JOIN public."catalog" curr      ON curr.catalog_id   = e.cat_currency
    LEFT JOIN LATERAL (
      SELECT u_pt.alias FROM public.payment_tokens pt
        LEFT JOIN public.users u_pt ON u_pt.user_id = COALESCE(pt.requested_by, pt.created_by)
       WHERE pt.enrollment_id = e.enrollment_id
       ORDER BY pt.token_id ASC LIMIT 1
    ) ag_token ON TRUE
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(pi.amount), 0) AS total_paid
        FROM public.payment_installments pi
        JOIN public."catalog" cs_pi ON cs_pi.catalog_id = pi.cat_status
       WHERE pi.enrollment_id = e.enrollment_id
         AND cs_pi.alias IN ('we_inst_paid', 'we_payment_status_paid')
    ) pay_agg ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS cnt
        FROM public.payment_installments pi
        JOIN public."catalog" cs ON cs.catalog_id = pi.cat_status
       WHERE pi.enrollment_id = e.enrollment_id
         AND pi.installment_number > 0
         AND pi.due_date < CURRENT_DATE
         AND cs.alias NOT IN ('we_inst_paid', 'we_payment_status_paid')
    ) inst_overdue ON TRUE
    WHERE c_plan.alias = 'we_payment_way_installments'
    ORDER BY e.enrollment_id
  `)
    return rows || []
  }

  // Cronograma para la hoja "CONT SISTEMAS": una fila por edicion, sin corte de
  // fecha (el planeamiento sigue trabajando ediciones viejas e inactivas; el
  // usecase decide con los flags `active` y `recent` cuales matchear al plan y
  // cuales anexar al final).
  // Los CUR1..CUR5 son las ediciones hijas colocadas en el SLOT que su
  // curso ocupa en el curriculum del programa (program_version_structure), igual
  // que la hoja manual: un diplomado con solo el modulo 4 programado llena CUR4 y
  // deja CUR1-3 vacios. Los contadores comerciales (ventas/segui/memb/b2b/becas)
  // NO se calculan aqui: el usecase los pega desde classroomChannelMetricsList
  // (modulo edition), que es la fuente confirmada con negocio del cronograma.
  async getFicoCronograma () {
    const { rows } = await this.db.query(`
    WITH struct AS (
      -- posicion (1..N) de cada curso dentro del curriculum de su programa padre
      SELECT parent_program_version_id,
             child_program_version_id,
             ROW_NUMBER() OVER (
               PARTITION BY parent_program_version_id
               ORDER BY sort_order, child_program_version_id
             ) AS slot
        FROM public.program_version_structure
    ),
    kids AS (
      SELECT es.parent_edition_id,
             jsonb_object_agg(
               st.slot::text,
               jsonb_build_object(
                 'name', pv_ch.abbreviation,
                 'ini',  to_char(ch.start_date, 'DD/MM/YYYY')
               )
             ) AS cursos
        FROM public.edition_structure es
        JOIN public.program_editions ch    ON ch.edition_num_id = es.child_edition_id AND ch.active = 'Y'
        JOIN public.program_versions pv_ch ON pv_ch.program_version_id = ch.program_version_id
        JOIN public.program_editions pep   ON pep.edition_num_id = es.parent_edition_id
        JOIN struct st ON st.parent_program_version_id = pep.program_version_id
                      AND st.child_program_version_id  = ch.program_version_id
       WHERE st.slot <= 5
       GROUP BY es.parent_edition_id
    ),
    rp AS (
      -- alumnos que DEJARON la edicion por reprogramacion (el RP queda en la
      -- edicion origen; su venta vive en el ACT destino).
      SELECT e.program_edition_id AS edition_num_id, COUNT(*)::int AS cnt_rp
        FROM public.enrollments e
        JOIN public."catalog" cf  ON cf.catalog_id  = e.cat_fico_status AND cf.alias  = 'we_enrollment_status_checked'
        JOIN public."catalog" cts ON cts.catalog_id = e.cat_type_status AND cts.alias = 'we_enrollment_status_reprogrammed'
       WHERE e.active = 'Y'
       GROUP BY e.program_edition_id
    )
    SELECT
      pe.edition_num_id,
      pe.active,
      (pe.start_date >= DATE '2025-06-01') AS recent,
      COALESCE(ctp.description, '')            AS categ,
      COALESCE(pv.version_code, '')            AS cod,
      COALESCE(pv.abbreviation, '')            AS programa,
      COALESCE(pe.global_code, '')             AS ed,
      to_char(pe.start_date, 'DD/MM/YYYY')     AS f_inicio,
      COALESCE(k.cursos, '{}'::jsonb)          AS cursos,
      COALESCE(rp.cnt_rp, 0)                   AS cnt_rp
      FROM public.program_editions pe
      JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
      JOIN public.programs p          ON p.program_id = pv.program_id
      LEFT JOIN public."catalog" ctp  ON ctp.catalog_id = p.cat_type_program
      LEFT JOIN kids k  ON k.parent_edition_id = pe.edition_num_id
      LEFT JOIN rp      ON rp.edition_num_id = pe.edition_num_id
     ORDER BY pe.start_date, pv.version_code, pe.edition_num_id
  `)
    return rows || []
  }

  // ── Lecturas / escrituras en Google Sheets ─────────────────────────────

  // Lee un rango de valores de un spreadsheet (filas como arrays de strings).
  async readRange (spreadsheetId, range) {
    const googleSheets = await this.sheets()
    const res = await googleSheets.spreadsheets.values.get({ spreadsheetId, range })
    return res.data.values || []
  }


  // Limpia un rango y escribe valores desde una celda de inicio. El clear es
  // obligatorio: si falla, el update solo sobrescribe las primeras N filas y deja
  // filas viejas debajo, mezclando datos de corridas distintas.
  async clearAndWrite (spreadsheetId, clearRange, writeRange, values) {
    const googleSheets = await this.sheets()
    await googleSheets.spreadsheets.values.clear({ spreadsheetId, range: clearRange })
    if (values.length > 0) {
      await googleSheets.spreadsheets.values.update({
        spreadsheetId,
        range: writeRange,
        valueInputOption: 'USER_ENTERED',
        resource: { values }
      })
    }
  }

  // Limpia desde A2 y escribe headers (A2 + valores) con la semantica legacy de
  // syncLeadsToSheet/syncScheduleToSheet/syncRprospectos: limpiar A2:ZZ y volcar
  // desde A2. Tolera fallo del clear con advertencia, igual que el legacy.
  async overwriteFromA2 (spreadsheetId, sheetName, values) {
    const googleSheets = await this.sheets()
    try {
      await googleSheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `${sheetName}!A2:ZZ`,
      })
    } catch (error) {
      console.warn('Advertencia al limpiar hoja:', error.message)
    }
    const res = await googleSheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A2`,
      valueInputOption: 'USER_ENTERED',
      resource: { values },
    })
    return res.data.updatedCells
  }

  // Anexa filas al final de una hoja, calculando la primera fila libre por la
  // columna A. Usado por syncInscToSheet (insert incremental).
  async appendRows (spreadsheetId, sheetName, values) {
    const googleSheets = await this.sheets()
    const response = await googleSheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:A`,
    })
    const existingRows = response.data.values || []
    const startRow = existingRows.length + 1
    const res = await googleSheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A${startRow}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values },
    })
    return res.data.updatedCells
  }

  // Vuelca el reporte completo de enrollments (vw_enrollment_report) sobre la
  // hoja SISTEMA-ORIGINAL: headers en A4, datos desde A5, sobreescritura total.
  async writeEnrollmentOriginal (spreadsheetId, headers, values) {
    const googleSheets = await this.sheets()
    await googleSheets.spreadsheets.values.update({
      spreadsheetId,
      range: `SISTEMA-ORIGINAL!A4`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [headers] },
    })
    try {
      await googleSheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `SISTEMA-ORIGINAL!A5:ZZ`,
      })
    } catch (e) {
      console.warn('Advertencia al limpiar SISTEMA-ORIGINAL:', e.message)
    }
    await googleSheets.spreadsheets.values.update({
      spreadsheetId,
      range: `SISTEMA-ORIGINAL!A5`,
      valueInputOption: 'USER_ENTERED',
      resource: { values },
    })
  }

  // Anexa filas nuevas a la hoja SISTEMA-PILOTO, calculando la primera fila libre
  // por la columna A. Devuelve las celdas actualizadas para el reporte.
  async appendEnrollmentPiloto (spreadsheetId, values) {
    const googleSheets = await this.sheets()
    const getResponse = await googleSheets.spreadsheets.values.get({
      spreadsheetId,
      range: `SISTEMA-PILOTO!A:A`,
    })
    const existingRows = getResponse.data.values || []
    const startRow = existingRows.length + 1
    const res = await googleSheets.spreadsheets.values.update({
      spreadsheetId,
      range: `SISTEMA-PILOTO!A${startRow}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values },
    })
    return res.data.updatedCells
  }

  // Asegura que una hoja exista (creandola con headers si no) y escribe
  // valores con clear previo. Usado por la hoja "3. Cuotas" generada por codigo.
  async ensureAndWrite (spreadsheetId, sheetName, headerRow, clearRange, writeRange, values) {
    const googleSheets = await this.sheets()
    const created = await this.ensureSheetExists(googleSheets, spreadsheetId, sheetName, headerRow)
    await googleSheets.spreadsheets.values.clear({ spreadsheetId, range: clearRange })
    if (values.length > 0) {
      await googleSheets.spreadsheets.values.update({
        spreadsheetId,
        range: writeRange,
        valueInputOption: 'USER_ENTERED',
        resource: { values }
      })
    }
    return created
  }

  // ── Slack ──────────────────────────────────────────────────────────────

  // Publica el mensaje de un pago web en el canal SLACK_CHANNEL_MATCH_WEB.
  async postEnrollmentWebToSlack ({ blocks, text }) {
    const slackClient = new WebClient(SLACK_TOKEN)
    await slackClient.chat.postMessage({
      channel: SLACK_CHANNEL,
      text,
      blocks,
    })
  }

  // Publica un reporte en Slack: si hay archivos, sube via files.uploadV2 con un
  // comentario inicial; si no, publica solo el bloque de titulo + texto.
  async postReportToSlack ({ titulo, texto, fileUploads }) {
    const client = new WebClient(SLACK_TOKEN)
    if (fileUploads.length > 0) {
      await client.files.uploadV2({
        channel_id: SLACK_CHANNEL,
        initial_comment: `*${titulo}*\n${texto}`,
        file_uploads: fileUploads,
      })
      return
    }
    await client.chat.postMessage({
      channel: SLACK_CHANNEL,
      text: titulo,
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: titulo, emoji: true } },
        { type: 'section', text: { type: 'mrkdwn', text: texto } }
      ]
    })
  }
}

export const integrationRepository = new IntegrationRepository()
