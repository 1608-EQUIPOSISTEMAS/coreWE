import { pool } from '../../shared/db/pool.js'
import { google } from 'googleapis'
import path from 'path'
import { WebClient } from '@slack/web-api'

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
// padre. En las 3 queries que ya filtran parent_enrollment_id IS NULL el NOT
// EXISTS es trivialmente verdadero; en getFicoAula (incluye hijas) es el que las
// atrapa.
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
         AND e.parent_enrollment_id IS NULL
         ${EXCLUDE_IMPORTED}
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
      COALESCE(
        l.origin_email,
        (SELECT pc.value FROM public.person_contacts pc
          JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact AND c.alias = 'we_way_contact_email'
         WHERE pc.person_id = per.person_id AND pc.active = 'Y'
         ORDER BY pc.registration_date DESC LIMIT 1)
      )                                                    AS correo,
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
      CASE WHEN COALESCE(prog.is_membership, false) THEN COALESCE(pv.abbreviation, '')
           ELSE COALESCE(mtier.abbreviation, '')
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
      SELECT COALESCE(
        l.origin_phone,
        (SELECT pc.value FROM public.person_contacts pc
          JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact AND c.alias = 'we_way_contact_phone'
         WHERE pc.person_id = per.person_id AND pc.active = 'Y'
         ORDER BY pc.registration_date DESC LIMIT 1)
      ) AS phone
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
      COALESCE(
        l.origin_phone,
        (SELECT pc.value FROM public.person_contacts pc
          JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact AND c.alias = 'we_way_contact_phone'
         WHERE pc.person_id = per.person_id AND pc.active = 'Y'
         ORDER BY pc.registration_date DESC LIMIT 1)
      )                                                    AS celular,
      COALESCE(
        l.origin_email,
        (SELECT pc.value FROM public.person_contacts pc
          JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact AND c.alias = 'we_way_contact_email'
         WHERE pc.person_id = per.person_id AND pc.active = 'Y'
         ORDER BY pc.registration_date DESC LIMIT 1)
      )                                                    AS correo,
      replace(to_char(p.amount, 'FM999990.00'), '.', ',')  AS monto,
      COALESCE(NULLIF(c_curr.variable_3, ''), c_curr.description, '') AS tipo_moneda,
      COALESCE(cm.description, '')                         AS medio_pago,
      COALESCE(cb.description, '')                         AS entidad_empresa,
      COALESCE(ba.bank_name, '')                           AS entidad_financiera,
      COALESCE(p.transaction_code, '')                     AS n_operacion
    FROM public.payments p
    JOIN public.enrollments e   ON e.enrollment_id = p.enrollment_id AND e.active = 'Y'
    JOIN public.customers cust  ON cust.customer_id = e.customer_id
    JOIN public.persons per     ON per.person_id = cust.person_id
    LEFT JOIN public.leads l              ON l.enrollment_id = e.enrollment_id
    LEFT JOIN public.program_versions pv  ON pv.program_version_id = e.program_version_id
    LEFT JOIN public."catalog" c_curr     ON c_curr.catalog_id = e.cat_currency
    LEFT JOIN public."catalog" cm         ON cm.catalog_id = p.cat_method_payment
    LEFT JOIN public.bank_accounts ba     ON ba.account_id = p.settled_in_account_id
    LEFT JOIN public."catalog" cb         ON cb.catalog_id = ba.business_entity_catalog_id
    WHERE p.active = 'Y'
      AND p.installment_id IS NULL
      AND p.cat_payment_type = (SELECT catalog_id FROM public."catalog" WHERE alias = 'we_payment_type_certificate' LIMIT 1)
    ORDER BY p.payment_date ASC, p.payment_id ASC
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
      COALESCE(
        l.origin_email,
        (SELECT pc.value FROM public.person_contacts pc
          JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact AND c.alias = 'we_way_contact_email'
         WHERE pc.person_id = per.person_id AND pc.active = 'Y'
         ORDER BY pc.registration_date DESC LIMIT 1)
      )                                                    AS correo,
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
      SELECT COALESCE(
        l.origin_phone,
        (SELECT pc.value FROM public.person_contacts pc
          JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact AND c.alias = 'we_way_contact_phone'
         WHERE pc.person_id = per.person_id AND pc.active = 'Y'
         ORDER BY pc.registration_date DESC LIMIT 1)
      ) AS phone
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

  async getFicoConsolidado () {
    const { rows } = await this.db.query(`
    WITH approved AS (
      SELECT e.enrollment_id
        FROM public.enrollments e
        JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
       WHERE cf.alias = 'we_enrollment_status_checked'
         AND e.active = 'Y'
         AND e.parent_enrollment_id IS NULL
         ${EXCLUDE_IMPORTED}
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
      COALESCE(
        l.origin_phone,
        (SELECT pc.value FROM public.person_contacts pc
          JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact AND c.alias = 'we_way_contact_phone'
         WHERE pc.person_id = per.person_id AND pc.active = 'Y'
         ORDER BY pc.registration_date DESC LIMIT 1)
      ) AS celular,
      COALESCE(
        l.origin_email,
        (SELECT pc.value FROM public.person_contacts pc
          JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact AND c.alias = 'we_way_contact_email'
         WHERE pc.person_id = per.person_id AND pc.active = 'Y'
         ORDER BY pc.registration_date DESC LIMIT 1)
      ) AS correo,
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
         AND e.parent_enrollment_id IS NULL
         ${EXCLUDE_IMPORTED}
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
      COALESCE(
        l.origin_phone,
        (SELECT pc.value FROM public.person_contacts pc
          JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact AND c.alias = 'we_way_contact_phone'
         WHERE pc.person_id = per.person_id AND pc.active = 'Y'
         ORDER BY pc.registration_date DESC LIMIT 1)
      ) AS celular,
      COALESCE(
        l.origin_email,
        (SELECT pc.value FROM public.person_contacts pc
          JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact AND c.alias = 'we_way_contact_email'
         WHERE pc.person_id = per.person_id AND pc.active = 'Y'
         ORDER BY pc.registration_date DESC LIMIT 1)
      ) AS correo,
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
