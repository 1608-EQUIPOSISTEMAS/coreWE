import { pool } from '../../shared/db/pool.js'
import { callProcedureReturningRows } from '../../shared/db/sp.js'
import { buildOdooEmailBase } from '../../utils/fico-odoo.helper.js'

// Los unicos estados de lead que negocio considera una CONSULTA. Cualquier otro
// (Eliminado, Cerrado, Desestimado, Indiferente, Prox. Inicio, Inscrito,
// Anulado) queda fuera del contador del cronograma.
export const LEAD_STATUSES_CONSULTA = [
  'we_lead_status_atendido',
  'we_lead_status_interesado',
  'we_lead_status_unique',
  'we_lead_status_will_pay',
  'we_lead_status_bought'
]

// B2B = venta de CONVENIOS. Manda el CANAL: si la venta dice "B2B - AE30", es
// B2B aunque AE30 sea comercial (regla del usuario, 07/09/26 — el canal es una
// decision explicita de alguien, el asesor solo dice quien la cerro). Esto
// REVIERTE la guarda del 13/07/26, que sacaba del B2B a los comerciales con
// codigo B2B y dejaba 156 ventas contradiciendo a la hoja "7. Convenios".
//
// El DOCUMENTO (OS/OP) es el unico marcador que si exige asesor de convenios
// (users.alias NY12/JF39) o ninguno: una Orden de Servicio es una forma de
// pago, no un convenio, y por si sola convertia en B2B las 4 ventas de AE30
// (16699, 16700, 18507, 18508 — sin canal, lead b2b='N', sin contrato).
//
// Recibe EXPRESIONES SQL, no alias: la "venta" es el padre cuando la fila es un
// hijo de paquete, y cada query la resuelve a su manera (par/e, e_sold/e, es/e).
export const isB2bSaleSql = ({ doctype, origin, advisor }) => `
           (COALESCE(${origin}, '') ILIKE '%b2b%'
            OR ((${doctype}) IS NOT NULL
                AND ((${advisor}) IS NULL OR (${advisor}) IN ('NY12','JF39'))))`

// Persistencia del dominio edition. Envuelve los stored procedures sp_edition_*
// y el SQL directo de metricas de aula y auditoria (classroom_audit_rubric).
export class EditionRepository {
  constructor (db = pool, sp = callProcedureReturningRows) {
    this.db = db
    this.sp = sp
  }

  async register (edition, user_id) {
    return this.sp(
      this.db,
      'public.sp_edition_register',
      [
        JSON.stringify(edition || {}),
        user_id
      ],
      { statementTimeoutMs: 25000 }
    )
  }

  async treeRegister (edition, user_id) {
    return this.sp(
      this.db,
      'public.sp_edition_tree_register',
      [
        JSON.stringify(edition || {}),
        user_id
      ],
      { statementTimeoutMs: 25000 }
    )
  }

  async list (filters) {
    return this.sp(
      this.db,
      'public.sp_edition_list',
      [JSON.stringify(filters)],
      { statementTimeoutMs: 25000 }
    )
  }

  async listByWeek (filters) {
    return this.sp(
      this.db,
      'public.sp_edition_by_week_list',
      [JSON.stringify(filters)],
      { statementTimeoutMs: 25000 }
    )
  }

  async update (payloadEdition, user_id) {
    return this.sp(
      this.db,
      'public.sp_edition_update',
      [
        JSON.stringify(payloadEdition),
        user_id
      ],
      { statementTimeoutMs: 25000 }
    )
  }

  async treeUpdate (edition, user_id) {
    return this.sp(
      this.db,
      'public.sp_edition_tree_update',
      [
        JSON.stringify(edition || {}),
        user_id
      ],
      { statementTimeoutMs: 25000 }
    )
  }

  async treeGet (editionId) {
    return this.sp(
      this.db,
      'public.sp_edition_tree_get',
      [editionId],
      { statementTimeoutMs: 25000 }
    )
  }

  async auditLogsGet (pedition_id, pLimit, pOffset) {
    return this.sp(
      this.db,
      'public.sp_audit_logs_get',
      [pedition_id, pLimit, pOffset],
      { statementTimeoutMs: 25000 }
    )
  }

  async caller (program_version_id, active, cat_status_edition, q, month, year) {
    return this.sp(
      this.db,
      'public.sp_edition_caller',
      [
        program_version_id,
        active,
        cat_status_edition,
        q,
        month,
        year
      ],
      { statementTimeoutMs: 15000 }
    )
  }

  async extraInfoCaller (program_version_id) {
    return this.sp(
      this.db,
      'public.sp_edition_extra_info_caller',
      [
        program_version_id
      ],
      { statementTimeoutMs: 15000 }
    )
  }

  // --- Cancelacion A5 -----------------------------------------------------
  //
  // Alumnos que siguen vivos en una edicion que va a pasar a A5 y por lo tanto
  // hay que reubicar antes de cancelarla. Mismos criterios de elegibilidad que
  // el roster del cronograma (classroomChannelMetricsList): activo, FICO-checked
  // y sin estado terminal. Devuelve TOP (la venta) e HIJO (modulo SEG de un
  // paquete) por igual: el RP de FICO sabe migrar ambos conservando el padre.
  async a5PendingEnrollments (editionId) {
    const { rows } = await this.db.query(`
      SELECT e.enrollment_id,
             (e.parent_enrollment_id IS NOT NULL)            AS is_child,
             TRIM(CONCAT_WS(' ', per.first_name, per.last_name,
                                 per.mother_last_name))      AS full_name,
             per.document_number,
             p.program_name,
             pp.program_name                                 AS parent_program_name,
             pep.global_code                                 AS parent_edition_code,
             -- Lo efectivamente cobrado, no el precio de lista: es el numero que
             -- mira Producto para decidir a que edicion mandar al alumno.
             COALESCE((SELECT SUM(pay.amount) FROM public.payments pay
                        WHERE pay.enrollment_id = e.enrollment_id
                          AND pay.active = 'Y'), 0)          AS amount_paid
        FROM public.enrollments e
        JOIN public."catalog" cf   ON cf.catalog_id = e.cat_fico_status
                                  AND cf.alias = 'we_enrollment_status_checked'
        LEFT JOIN public."catalog" cts ON cts.catalog_id = e.cat_type_status
        JOIN public.customers cust ON cust.customer_id = e.customer_id
        JOIN public.persons per     ON per.person_id = cust.person_id
        LEFT JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
        LEFT JOIN public.programs p          ON p.program_id = pv.program_id
        LEFT JOIN public.enrollments par     ON par.enrollment_id = e.parent_enrollment_id
        LEFT JOIN public.program_versions ppv ON ppv.program_version_id = par.program_version_id
        LEFT JOIN public.programs pp          ON pp.program_id = ppv.program_id
        LEFT JOIN public.program_editions pep ON pep.edition_num_id = par.program_edition_id
       WHERE e.program_edition_id = $1
         AND e.active = 'Y'
         AND (cts.alias IS NULL OR cts.alias NOT IN (
                'we_enrollment_status_retired',
                'we_enrollment_status_course_changed',
                'we_enrollment_status_reprogrammed'))
       ORDER BY is_child, full_name
    `, [editionId])
    return rows
  }

  // Cambia SOLO el segmento. No pasa por sp_edition_update a proposito: ese SP
  // reescribe la edicion entera y revalida fechas/docente/vacantes, y aqui la
  // migracion A5 ya se ejecuto — un rechazo tardio dejaria alumnos migrados con
  // la edicion todavia sin cancelar.
  async setSegment (editionId, segmentId) {
    const { rowCount } = await this.db.query(
      'UPDATE public.program_editions SET cat_segment = $2 WHERE edition_num_id = $1',
      [editionId, segmentId]
    )
    return rowCount
  }

  async getSegment (editionId) {
    const { rows } = await this.db.query(
      'SELECT cat_segment FROM public.program_editions WHERE edition_num_id = $1',
      [editionId]
    )
    return rows[0]?.cat_segment ?? null
  }

  // catalog_id del segmento A5 por alias. Nunca hardcodear el id: A5 es 3060 y
  // 5063 es A7, y ya hubo un guard viejo que confundio los dos.
  async a5SegmentId () {
    const { rows } = await this.db.query(
      `SELECT catalog_id FROM public."catalog" WHERE alias = 'we_segment_a5' LIMIT 1`
    )
    return rows[0]?.catalog_id ?? null
  }

  // Actualiza el link de WhatsApp de una edicion por abreviatura del programa y
  // fecha de inicio. Devuelve rowCount para distinguir aciertos de no-encontrados.
  async updateWhatsappLink (whatsappLink, abbreviation, isoDate) {
    const { rowCount } = await this.db.query(`
      UPDATE program_editions pe
      SET whatsapp_link = $1
      FROM program_versions pv
      WHERE pv.program_version_id = pe.program_version_id
        AND UPPER(TRIM(pv.abbreviation)) = UPPER(TRIM($2))
        AND pe.start_date::date = $3::date
    `, [whatsappLink, abbreviation, isoDate])
    return rowCount
  }

  // ── RECURSOS DE EVENTO POR EDICION ────────────────────────────────────
  // Banner, formularios y detalle de sesiones que consume la plantilla de
  // correo confirmacion-evento.js.
  //
  // SQL directo y no sp_edition_update / sp_edition_tree_get: esos SPs reciben
  // el objeto `edition` serializado y no conocen las columnas nuevas, no estan
  // versionados en este repo y no se pueden editar a ciegas. Mismo criterio que
  // updateWhatsappLink (arriba) y academicReportList (abajo).
  async getEventResources (editionNumId) {
    const { rows } = await this.db.query(`
      SELECT pe.edition_num_id,
             pe.banner_mime,
             (pe.banner_image IS NOT NULL) AS has_banner_image,
             pe.banner_link,
             pe.whatsapp_link,
             pe.certificate_form_link,
             pe.business_card_link,
             pe.session_detail_virtual,
             pe.session_detail_onsite,
             COALESCE(NULLIF(pe.banner_link, ''), prog.banner_link) AS effective_banner_link
        FROM public.program_editions pe
        JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
        JOIN public.programs prog ON prog.program_id = pv.program_id
       WHERE pe.edition_num_id = $1
    `, [editionNumId])
    return rows?.[0] || null
  }

  // Ediciones que alimentan el selector del modulo de Eventos (Fundacion).
  //
  // El tipo de programa en el catalogo se llama "Congreso / Evento", no
  // "Evento": por eso no basta con el alias. Se aceptan CUATRO senales, unidas
  // con OR, para que ninguna edicion desaparezca del selector por un dato mal
  // puesto en otra pantalla:
  //   1. el alias canonico del catalogo,
  //   2. la etiqueta del tipo (congreso / evento), por si el alias difiere,
  //   3. que ya tenga recursos cargados,
  //   4. que tenga inscritos con categoria de entrada (solo los eventos la usan).
  //
  // Tampoco se filtra por pe.active: un congreso ya pasado se desactiva, y sus
  // recursos siguen necesitando correccion. Los activos van primero en el orden.
  async listEventEditions (search = null) {
    const { rows } = await this.db.query(`
      SELECT pe.edition_num_id,
             pe.global_code,
             pe.specific_code,
             pe.start_date,
             pe.active,
             pv.abbreviation,
             c_type.alias       AS program_type_alias,
             c_type.description AS program_type_label,
             (pe.banner_image IS NOT NULL) AS has_banner_image,
             (pe.certificate_form_link IS NOT NULL
               OR pe.business_card_link IS NOT NULL
               OR pe.session_detail_virtual IS NOT NULL
               OR pe.session_detail_onsite IS NOT NULL) AS has_resources
        FROM public.program_editions pe
        JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
        JOIN public.programs prog ON prog.program_id = pv.program_id
        LEFT JOIN public.catalog c_type ON c_type.catalog_id = prog.cat_type_program
       WHERE (
           c_type.alias = 'we_program_type_event'
           OR c_type.description ILIKE '%congreso%'
           OR c_type.description ILIKE '%evento%'
           OR pe.banner_image IS NOT NULL
           OR pe.certificate_form_link IS NOT NULL
           OR pe.session_detail_virtual IS NOT NULL
           OR pe.session_detail_onsite IS NOT NULL
           OR EXISTS (SELECT 1 FROM public.enrollments e
                       WHERE e.program_edition_id = pe.edition_num_id
                         AND e.cat_event_category IS NOT NULL)
         )
         AND ($1::text IS NULL OR pv.abbreviation ILIKE '%' || $1 || '%')
       ORDER BY (pe.active = 'Y') DESC, pe.start_date DESC NULLS LAST
       LIMIT 200
    `, [search])
    return rows || []
  }

  // ── REPORTE DE OBJETIVOS DEL EVENTO (Fundacion > Objetivos) ────────────
  //
  // A que area se le acredita una venta. No hay columna "area": se deduce de
  // como llego la inscripcion, en ESTE orden (el primero que engancha gana):
  //
  //   Members   el cliente ya tiene una membresia vigente
  //   B2B       agent_origin 'B2B', contrato b2b, o el lead marcado b2b
  //   Fundacion agent_origin 'FWE' o vendida por un asesor de Fundacion
  //   Comercial el lead trae Estrategia (campo lleno = trabajo del asesor)
  //   Marketing el lead llego por redes (FB / IG / LinkedIn / Estados)
  //   Web       agent_origin 'WEB' o el lead marcado web
  //   Otros     no llego por ningun canal: entro solo y consulto
  //
  // ponytail: el orden ES la regla de negocio, por eso va en un solo CASE y no
  // repartido en siete queries. Members primero segun lo pedido; si algun dia
  // una venta de socio debe acreditarse a su canal, se baja esa rama y listo.
  // OJO: la rama del ponente mira `c.alias`, que viene del LEFT JOIN al catalogo
  // que hace el SELECT de eventReportAreas. Va primero porque un ponente puede
  // ser socio o haber llegado por un canal, y aun asi se reporta como ponente.
  static AREA_CASE = `
    CASE
      WHEN c.alias = 'we_event_category_ponente'                     THEN '1.8'
      WHEN i.tier IS NOT NULL                                        THEN '1.7'
      WHEN i.agent_origin = 'B2B' OR i.b2b_contract_id IS NOT NULL
           OR i.lead_b2b = 'Y'                                       THEN '1.4'
      WHEN i.agent_origin = 'FWE' OR i.asesor ILIKE '%FUN%'          THEN '1.5'
      WHEN i.cat_type_strategy IS NOT NULL                           THEN '1.1'
      WHEN i.canal_alias IN ('we_social_media_facebook','we_social_media_instagram',
                             'we_social_media_linkedin','we_social_media_estados')  THEN '1.2'
      WHEN i.agent_origin = 'WEB' OR i.lead_web = 'Y'
           OR i.canal_alias = 'we_social_media_wechat'               THEN '1.3'
      ELSE '1.6'
    END`

  // Avance real por area y modalidad. Una inscripcion cuenta si esta viva:
  // active='Y' y sin estado de baja (R / RP / CC). No se exige pago.
  async eventReportAreas (editionId) {
    const { rows } = await this.db.query(`
      WITH miembros AS (
        SELECT em.customer_id, max(em.membership_program_id) AS tier
          FROM public.enrollments em
          LEFT JOIN public.catalog sm ON sm.catalog_id = em.cat_type_status
         WHERE em.membership_program_id IS NOT NULL
           AND em.active = 'Y'
           AND coalesce(sm.alias, '') NOT IN ('we_enrollment_status_retired',
                                              'we_enrollment_status_reprogrammed',
                                              'we_enrollment_status_course_changed')
         GROUP BY em.customer_id
      ),
      i AS (
        SELECT e.enrollment_id,
               e.cat_event_category,
               e.agent_origin,
               e.b2b_contract_id,
               u.alias                AS asesor,
               l.cat_type_strategy,
               l.b2b                  AS lead_b2b,
               l.web                  AS lead_web,
               ch.alias               AS canal_alias,
               m.tier,
               pm.program_name        AS tier_name
          FROM public.enrollments e
          LEFT JOIN public.users u ON u.user_id = e.seller_agent_id
          LEFT JOIN public.catalog st ON st.catalog_id = e.cat_type_status
          LEFT JOIN LATERAL (
                 SELECT l2.cat_type_strategy, l2.cat_channel, l2.b2b, l2.web
                   FROM public.leads l2
                  WHERE l2.enrollment_id = e.enrollment_id
                  ORDER BY l2.lead_id LIMIT 1
               ) l ON true
          LEFT JOIN public.catalog ch ON ch.catalog_id = l.cat_channel
          LEFT JOIN miembros m ON m.customer_id = e.customer_id
          LEFT JOIN public.programs pm ON pm.program_id = m.tier
         WHERE e.program_edition_id = $1
           AND e.active = 'Y'
           AND coalesce(st.alias, '') NOT IN ('we_enrollment_status_retired',
                                              'we_enrollment_status_reprogrammed',
                                              'we_enrollment_status_course_changed')
      )
      SELECT ${EditionRepository.AREA_CASE} AS area_code,
             i.tier,
             i.tier_name,
             count(*)                                                       AS avance,
             -- El ponente no compra entrada pero ocupa butaca VIP: suma en esa
             -- columna, en su propia fila (1.8). Por eso PONENTE no es una
             -- modalidad mas del cuadro.
             count(*) FILTER (WHERE c.alias IN ('we_event_category_vip',
                                                'we_event_category_ponente'))  AS vip,
             count(*) FILTER (WHERE c.alias = 'we_event_category_premium')   AS premium,
             count(*) FILTER (WHERE c.alias = 'we_event_category_general')   AS general,
             count(*) FILTER (WHERE c.alias = 'we_event_category_virtual')   AS virtual,
             count(*) FILTER (WHERE i.cat_event_category IS NULL)            AS sin_categoria
        FROM i
        LEFT JOIN public.catalog c ON c.catalog_id = i.cat_event_category
       GROUP BY 1, 2, 3
    `, [editionId])
    return rows || []
  }

  // Consultas (leads) por area. Misma regla, con lo que un lead sí tiene:
  // no hay agent_origin, así que Fundacion se reconoce por su estrategia o por
  // el usuario que registro el lead.
  async eventReportLeads (editionId) {
    const { rows } = await this.db.query(`
      SELECT CASE
               WHEN l.b2b = 'Y'                                    THEN '1.4'
               WHEN st.description ILIKE 'fundaci%'
                    OR u.alias ILIKE '%FUN%'                       THEN '1.5'
               WHEN l.cat_type_strategy IS NOT NULL                THEN '1.1'
               WHEN ch.alias IN ('we_social_media_facebook','we_social_media_instagram',
                                 'we_social_media_linkedin','we_social_media_estados') THEN '1.2'
               WHEN l.web = 'Y' OR ch.alias = 'we_social_media_wechat' THEN '1.3'
               ELSE '1.6'
             END AS area_code,
             count(*) AS consultas
        FROM public.leads l
        LEFT JOIN public.catalog st ON st.catalog_id = l.cat_type_strategy
        LEFT JOIN public.catalog ch ON ch.catalog_id = l.cat_channel
        LEFT JOIN public.users u ON u.user_id = l.user_registration_id
       WHERE l.program_edition_id = $1 AND l.active = 'Y'
       GROUP BY 1
    `, [editionId])
    return rows || []
  }

  // Que categorias de entrada se venden en este congreso. Sin fila activa en
  // event_category_prices la columna no se dibuja: el cuadro del cliente tiene
  // tres modalidades porque PREMIUM esta apagado, no porque no exista.
  async eventReportCategories (editionId) {
    const { rows } = await this.db.query(`
      SELECT c.catalog_id, c.alias, c.description
        FROM public.program_editions pe
        JOIN public.event_category_prices ecp ON ecp.program_version_id = pe.program_version_id
        JOIN public.catalog c ON c.catalog_id = ecp.cat_event_category
       WHERE pe.edition_num_id = $1 AND ecp.active = 'Y'
       ORDER BY c.catalog_id
    `, [editionId])
    return rows || []
  }

  // El objetivo es MANUAL y vive en el jsonb que ya tenia la tabla de metas:
  // no hace falta tabla nueva para una matriz de 7 areas x 4 modalidades.
  async eventGoalsGet (editionId) {
    const { rows } = await this.db.query(
      `SELECT channel_goals FROM public.program_edition_goals WHERE edition_num_id = $1`,
      [editionId]
    )
    return rows[0]?.channel_goals || {}
  }

  async eventGoalsSave (editionId, goals, uid) {
    const { rows } = await this.db.query(`
      INSERT INTO public.program_edition_goals (edition_num_id, channel_goals, user_registration_id, registration_date)
      VALUES ($1, $2::jsonb, $3, NOW())
      ON CONFLICT (edition_num_id) DO UPDATE
         SET channel_goals = EXCLUDED.channel_goals,
             user_modification_id = $3,
             modification_date = NOW()
      RETURNING channel_goals
    `, [editionId, JSON.stringify(goals || {}), uid || null])
    return rows[0]?.channel_goals || {}
  }

  // Bytes del banner para previsualizarlo en el modal. Query aparte: no debe
  // viajar en el get general de recursos.
  async getEventBannerImage (editionNumId) {
    const { rows } = await this.db.query(
      `SELECT banner_image, banner_mime
         FROM public.program_editions
        WHERE edition_num_id = $1 AND banner_image IS NOT NULL`,
      [editionNumId]
    )
    return rows?.[0] || null
  }

  // ── CATEGORIAS DE ENTRADA POR EVENTO ──────────────────────────────────
  // Traduce edicion -> version del programa. Lo piden las categorias de entrada
  // (sus precios cuelgan de program_version_id, no de la edicion) y la
  // cancelacion A5, que necesita el programa destino para proponer el RP.
  async programVersionOf (editionNumId) {
    const { rows } = await this.db.query(
      `SELECT program_version_id FROM public.program_editions WHERE edition_num_id = $1`,
      [editionNumId]
    )
    return rows?.[0]?.program_version_id || null
  }

  // Siempre devuelve las cuatro del catalogo: la pantalla necesita mostrar las
  // apagadas para poder encenderlas. `enabled` dice cuales se venden hoy.
  async getEventCategories (programVersionId) {
    const { rows } = await this.db.query(`
      SELECT c.catalog_id AS cat_event_category,
             c.alias,
             c.description,
             COALESCE(p.active, 'N') = 'Y'             AS enabled,
             COALESCE(p.price_student_soles,       0)  AS price_student_soles,
             COALESCE(p.price_student_dollars,     0)  AS price_student_dollars,
             COALESCE(p.price_profesional_soles,   0)  AS price_profesional_soles,
             COALESCE(p.price_profesional_dollars, 0)  AS price_profesional_dollars,
             p.whatsapp_link
        FROM public.catalog c
        JOIN public.catalog parent ON parent.catalog_id = c.catalog_parent_id
        LEFT JOIN public.event_category_prices p
               ON p.cat_event_category = c.catalog_id
              AND p.program_version_id = $1
       WHERE parent.alias = 'we_event_category'
         AND c.active = 'Y'
       ORDER BY c.description
    `, [programVersionId])
    return rows || []
  }

  // Upsert de las cuatro filas en una sola sentencia. Apagar una categoria la
  // deja en active='N' y NO la borra: hay inscripciones que la referencian y su
  // precio es parte del historico de la venta.
  async saveEventCategories (programVersionId, categories) {
    if (!categories.length) return 0
    const values = []
    const params = [programVersionId]
    for (const c of categories) {
      const i = params.length
      params.push(
        c.cat_event_category, c.enabled ? 'Y' : 'N',
        c.price_student_soles, c.price_student_dollars,
        c.price_profesional_soles, c.price_profesional_dollars,
        c.whatsapp_link
      )
      values.push(`($1, $${i + 1}::integer, $${i + 2}::char(1), $${i + 3}::numeric, $${i + 4}::numeric, $${i + 5}::numeric, $${i + 6}::numeric, $${i + 7}::text)`)
    }
    const { rowCount } = await this.db.query(`
      INSERT INTO public.event_category_prices
        (program_version_id, cat_event_category, active,
         price_student_soles, price_student_dollars,
         price_profesional_soles, price_profesional_dollars, whatsapp_link)
      VALUES ${values.join(', ')}
      ON CONFLICT (program_version_id, cat_event_category) DO UPDATE
        SET active                    = EXCLUDED.active,
            price_student_soles       = EXCLUDED.price_student_soles,
            price_student_dollars     = EXCLUDED.price_student_dollars,
            price_profesional_soles   = EXCLUDED.price_profesional_soles,
            price_profesional_dollars = EXCLUDED.price_profesional_dollars,
            whatsapp_link             = EXCLUDED.whatsapp_link
    `, params)
    return rowCount
  }

  // Solo escribe las claves presentes en `fields`: guardar un campo suelto no
  // debe pisar los otros cinco a NULL. Los nombres vienen ya filtrados contra
  // una whitelist en el usecase, nunca directo del request.
  // Setter generico de columnas de una edicion. El SET se arma con las claves
  // que llegan, asi que el usecase que lo llame DEBE filtrarlas contra su propia
  // whitelist: aca no hay defensa contra un nombre de columna arbitrario.
  async updateEditionColumns (editionNumId, fields) {
    const names = Object.keys(fields)
    if (!names.length) return 0
    const sets = names.map((name, i) => `${name} = $${i + 2}`).join(', ')
    const { rowCount } = await this.db.query(
      `UPDATE public.program_editions SET ${sets} WHERE edition_num_id = $1`,
      [editionNumId, ...names.map(n => fields[n])]
    )
    return rowCount
  }

  // Conteo de alumnos por edicion (aula): inscripciones FICO-aprobadas, activas
  // y solo hojas del arbol. HOJA = sin hijos: un destino de cambio de curso
  // hacia un paquete tiene padre (el origen) Y sus propios hijos SEG; el que
  // asiste es el hijo, no el.
  async classroomMetricsList (ids) {
    const { rows } = await this.db.query(`
    SELECT e.program_edition_id AS edition_num_id,
           COUNT(*)::int        AS students
      FROM public.enrollments e
      JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
     WHERE e.program_edition_id = ANY($1::int[])
       AND e.active = 'Y'
       AND cf.alias = 'we_enrollment_status_checked'
       AND NOT EXISTS (
              SELECT 1 FROM public.enrollments c
               WHERE c.parent_enrollment_id = e.enrollment_id
            )
     GROUP BY e.program_edition_id
  `, [ids])
    return rows
  }

  // Contadores del cronograma por edicion. Son DOS metricas distintas que NO
  // suman entre si (ver hoja de referencia de negocio):
  //
  //  A) COMERCIAL (columnas VENTAS / SEGUI / B2B / MEMB / BECA): donde se REGISTRA
  //     la venta o el seguimiento. La venta de un paquete vive en el PADRE, no en
  //     el hijo. Por eso el PADRE (especializacion/diploma) SI muestra sus ventas
  //     en su fila (VENTAS/B2B/MEMB), aunque su AULA sea 0.
  //       - PADRE (tiene hijos) o VENTA DIRECTA (standalone): es la venta. Canal
  //         por el enrollment: MEMB (socio) > B2B (canal 'B2B', sea quien sea el
  //         asesor; o documento OS/OP con asesor de convenios o sin asesor —
  //         ver isB2bSaleSql) > BECA (total 0) > VENTAS.
  //       - 1er CURSO de un paquete (hijo sin hermano que empiece antes, = orden
  //         de la rama en la modal Jerarquia): NO cuenta comercial; su venta esta
  //         arriba, en el padre. EXCEPCION: si el paquete tiene algun modulo
  //         CONVALIDADO, ese fue el 1er curso (se curso antes y no genera hijo),
  //         asi que TODOS los hijos que si existen cuentan como seguimiento.
  //       - 2do+ CURSO de un paquete (o modulo E0, o destino de CAMBIO DE CURSO):
  //         HEREDA el CANAL de la venta del padre. Si el padre es socio/B2B/beca,
  //         el seguimiento cuenta en MEMB/B2B/BECA, NO en SEGUI. SEGUI queda solo
  //         para hijos de una venta NORMAL. Prioridad: MEMB (socio) > B2B (padre
  //         doctype/agent) > BECA (padre total 0) > SEGUI.
  //       - E0 (padre con program_edition_id NULL: modulos inscritos sueltos): no
  //         hay 1er curso especial; TODOS los modulos heredan el canal del padre
  //         (la venta del diploma se vendio aparte, no aparece como venta aqui).
  //
  //  B) AULA (columna AULA = headcount del salon): cuantos alumnos ASISTEN a esa
  //     edicion. Son las HOJAS (hijos + ventas directas) con esa program_edition_id;
  //     el PADRE no es un aula => AULA 0. El 1er curso SI cuenta en el AULA de su
  //     edicion (asiste), aunque su venta este en el padre. Por eso AULA suele ser
  //     MAYOR que VENTAS+SEGUI+MEMB de la misma fila (incluye a los 1er-curso de
  //     paquetes cuya venta esta arriba). cnt_aula excluye becas (vista gerencia);
  //     cnt_total las incluye (= headcount academico, todas las hojas).
  //
  // Elegibilidad (ambas metricas): activo, FICO-checked, y cat_type_status NO en
  // {retirado, cambiado_de_curso, REPROGRAMADO}. El RP es el registro de la
  // edicion que el alumno DEJO (su venta vive en el ACT destino, otra edicion):
  // "si es RP no se cuenta".
  // ponytail: los EXISTS (membresia, hijos, hermanos, course_changes) corren por
  // inscrito; con ~100 ediciones/mes es holgado. Si crece, materializar.
  async classroomChannelMetricsList (ids) {
    const { rows } = await this.db.query(`
    WITH roster AS (
      SELECT
        e.program_edition_id AS edition_num_id,
        -- A) bucket COMERCIAL (donde se registra la venta/seguimiento). NULL = no
        --    cuenta comercial: 1er curso de paquete (su venta vive en el padre).
        CASE
          -- destino de cambio de curso o de reprogramacion (RP) => seguimiento en
          -- su aula nueva. El destino RP nace con total 0 (la venta vive en el
          -- origen) y se identifica por la nota que escribe reprogramEdition.
          -- La BECA manda sobre el seguimiento: mover de aula a un becado no le
          -- quita la beca (caso 16361, hijo reprogramado de una venta BECA: caia
          -- en SEG y el aula lo veia beca => la fila descuadraba en 1).
          WHEN EXISTS (SELECT 1 FROM public.course_changes cc
                        WHERE cc.enrollment_destination_id = e.enrollment_id)
            OR e.notes ILIKE '%Reprogramacion desde inscripcion #%'
            THEN CASE WHEN mem.is_member THEN 'MEMB'
                      WHEN bec.is_beca THEN 'BECA'
                      ELSE 'SEGUI' END
          -- HIJO de paquete:
          WHEN e.parent_enrollment_id IS NOT NULL THEN
            CASE
              -- 1er curso (sin hermano que empiece antes) de un paquete CON edicion:
              -- su venta vive en el padre, no cuenta comercial. (Un E0 no tiene 1er
              -- curso especial: el padre no cuenta, todos los modulos heredan canal.)
              WHEN par.program_edition_id IS NOT NULL AND NOT EXISTS (
                     SELECT 1 FROM public.enrollments sib
                       JOIN public.program_editions pesib
                         ON pesib.edition_num_id = sib.program_edition_id
                      WHERE sib.parent_enrollment_id = e.parent_enrollment_id
                        AND sib.enrollment_id <> e.enrollment_id
                        AND (pesib.start_date, pesib.edition_num_id)
                          < (pe_e.start_date, pe_e.edition_num_id)
                   )
                   -- ...salvo que el paquete traiga un modulo CONVALIDADO: ese no
                   -- genera hijo (el alumno ya lo curso antes, es su 1er curso
                   -- real), asi que el hijo mas temprano que SI existe es
                   -- seguimiento, no la venta. Sin esto se le perdia el canal y
                   -- la fila no cuadraba con su AULA. 'edition_override' no
                   -- convalida (se inscribe en otra edicion): mismo criterio que
                   -- isValidated() en la pantalla de FICO.
                   AND NOT EXISTS (
                     SELECT 1 FROM public.enrollment_validations ev
                      WHERE ev.enrollment_id = e.parent_enrollment_id
                        AND ev.validation_type <> 'edition_override'
                   ) THEN NULL
              -- 2do+ curso (o modulo E0): HEREDA el CANAL de la venta del padre.
              -- Si el padre es socio/B2B/beca, el seguimiento cuenta en MEM/B2B/BECA,
              -- NO en SEG. SEG queda solo para hijos de una venta normal (una OS
              -- de un comercial lo es: documento no es convenio).
              -- Prioridad: socio manda > B2B > BECA > SEG.
              WHEN mem.is_member THEN 'MEMB'
              WHEN ${isB2bSaleSql({ doctype: 'par.cat_b2b_doctype', origin: 'par.agent_origin', advisor: 'upar.alias' })} THEN 'B2B'
              WHEN bec.is_beca THEN 'BECA'
              ELSE 'SEGUI'
            END
          -- PADRE (tiene hijos) o VENTA DIRECTA (standalone): es la venta.
          WHEN mem.is_member THEN 'MEMB'
          WHEN ${isB2bSaleSql({ doctype: 'e.cat_b2b_doctype', origin: 'e.agent_origin', advisor: 'ua.alias' })} THEN 'B2B'
          WHEN bec.is_beca THEN 'BECA'
          ELSE 'VENTAS'
        END AS comm_bucket,
        -- B) HOJA = asiste a un aula = NO tiene hijos. El PADRE (tiene hijos) NO
        --    es aula, aunque tenga padre a su vez (destino de cambio de curso
        --    hacia un paquete: su padre es el origen del CC y sus hijos SEG son
        --    los que asisten). Misma regla que classroomMetricsList.
        (NOT EXISTS (SELECT 1 FROM public.enrollments ch
                      WHERE ch.parent_enrollment_id = e.enrollment_id)) AS is_leaf,
        -- beca de la hoja: el MISMO flag que usa la cascada comercial (LATERAL
        -- bec). Que AULA y el canal compartan criterio es lo que garantiza
        -- AULA = VENTAS+SEGUI+MEMB+B2B; cuando eran dos predicados gemelos
        -- divergieron y la fila descuadraba.
        bec.is_beca AS is_beca_leaf
        FROM public.enrollments e
        JOIN public."catalog" cf   ON cf.catalog_id = e.cat_fico_status
        LEFT JOIN public."catalog" cts ON cts.catalog_id = e.cat_type_status
        JOIN public.customers cust ON cust.customer_id = e.customer_id
        JOIN public.program_editions pe_e ON pe_e.edition_num_id = e.program_edition_id
        -- venta del padre (solo hijos): para resolver beca/canal del 1er curso.
        LEFT JOIN public.enrollments par ON par.enrollment_id = e.parent_enrollment_id
        LEFT JOIN public."catalog" parcts ON parcts.catalog_id = par.cat_type_status
        -- segmento de la edicion del padre: si el diploma se cancelo (A5) sus
        -- modulos no asisten a ningun aula (ver WHERE).
        LEFT JOIN public.program_editions pe_par ON pe_par.edition_num_id = par.program_edition_id
        LEFT JOIN public."catalog" parseg ON parseg.catalog_id = pe_par.cat_segment
        -- asesor de la venta (propia y del padre): el codigo B2B (NY12/JF39) vive
        -- en users.alias, NO en agent_origin (el importador los separa).
        LEFT JOIN public.users ua   ON ua.user_id = e.seller_agent_id
        LEFT JOIN public.users upar ON upar.user_id = par.seller_agent_id
        LEFT JOIN LATERAL (
          -- is_member (columna MEMB): membresia FICO-aprobada y vigente que REGALA
          -- cursos (WE BLACK/GOLD/PLAT). Se EXCLUYE 'MEMBRESIA PLUS': no da cursos
          -- de beneficio, asi que un socio PLUS que lleva un curso es VENTA real,
          -- no MEMB. Confirmado con negocio.
          -- has_membership (para BECA): CUALQUIER tier, incluido PLUS. Es el mismo
          -- criterio que mem.tier_name de classroomStudentsList: un socio (aunque
          -- sea PLUS) con venta en 0 NO es beca; asi la Lista de Notas y el
          -- cronograma cuentan las mismas becas.
          -- Ademas de la busqueda por persona, vale el tier grabado EN LA VENTA
          -- (enrollments.membership_program_id): la membresia puede estar en OTRA
          -- fila de persons (el SP crea persona nueva cuando la venta va sin DNI)
          -- y entonces la busqueda por person_id falla y el socio caia a BECA.
          SELECT
            (EXISTS (
              SELECT 1
                FROM public.enrollments em
                JOIN public.customers cm         ON cm.customer_id = em.customer_id
                JOIN public.program_versions pvm ON pvm.program_version_id = em.program_version_id
                JOIN public.programs pm          ON pm.program_id = pvm.program_id AND pm.is_membership = true
                                                  AND UPPER(TRIM(pm.program_name)) <> 'MEMBRESIA PLUS'
                JOIN public."catalog" cfm        ON cfm.catalog_id = em.cat_fico_status AND cfm.alias = 'we_enrollment_status_checked'
               WHERE cm.person_id = cust.person_id AND em.active = 'Y'
            ) OR EXISTS (
              SELECT 1 FROM public.programs pmv
               WHERE pmv.program_id = COALESCE(par.membership_program_id, e.membership_program_id)
                 AND pmv.is_membership = true
                 AND UPPER(TRIM(pmv.program_name)) <> 'MEMBRESIA PLUS'
            )) AS is_member,
            (EXISTS (
              SELECT 1
                FROM public.enrollments em
                JOIN public.customers cm         ON cm.customer_id = em.customer_id
                JOIN public.program_versions pvm ON pvm.program_version_id = em.program_version_id
                JOIN public.programs pm          ON pm.program_id = pvm.program_id AND pm.is_membership = true
                JOIN public."catalog" cfm        ON cfm.catalog_id = em.cat_fico_status AND cfm.alias = 'we_enrollment_status_checked'
               WHERE cm.person_id = cust.person_id AND em.active = 'Y'
            ) OR COALESCE(par.membership_program_id, e.membership_program_id) IS NOT NULL) AS has_membership
        ) mem ON TRUE
        LEFT JOIN LATERAL (
          -- BECA = la venta (propia o la del padre, que es donde vive) en total 0,
          -- sin documento corporativo y sin socio de ningun tier. OJO: aqui el
          -- doctype o canal B2B excluyen la beca SIEMPRE, sin mirar al asesor.
          -- Es mas ancho que el B2B de la cascada (isB2bSaleSql, donde el
          -- documento exige asesor de convenios) y tiene que serlo: una OS/OP de
          -- un comercial no es convenio, pero tampoco es una beca — la empresa
          -- emitio un documento. Esa venta cae a VENTAS, la ultima rama, asi que
          -- AULA = VEN+SEG+MEM+B2B se mantiene. Lo que NO puede pasar es lo
          -- contrario (beca mas ancha que B2B): ahi la fila descuadra, porque el
          -- alumno sale del AULA por is_beca_leaf pero sigue sumando en su canal.
          -- Un destino RP/CC (o sus hijos) NO
          -- es beca: su total 0 es convencion del flujo, la venta real vive en el
          -- origen. Mismo criterio is_beca que classroomStudentsList.
          -- Fuente UNICA de la beca: la cascada comercial y la columna AULA leen
          -- de aqui, si no vuelven a divergir.
          SELECT (COALESCE(e.cat_b2b_doctype, par.cat_b2b_doctype) IS NULL
            AND COALESCE(par.agent_origin, e.agent_origin, '') NOT ILIKE '%b2b%'
            AND COALESCE(par.total_amount, e.total_amount, 0) = 0
            AND NOT mem.has_membership
            AND COALESCE(CASE WHEN e.parent_enrollment_id IS NOT NULL
                              THEN par.notes ELSE e.notes END, '')
                NOT ILIKE '%desde inscripcion #%'
            AND NOT EXISTS (SELECT 1 FROM public.course_changes ccx
                             WHERE ccx.enrollment_destination_id
                                   = COALESCE(e.parent_enrollment_id, e.enrollment_id))) AS is_beca
        ) bec ON TRUE
       WHERE e.program_edition_id = ANY($1::int[])
         AND e.active = 'Y'
         AND cf.alias = 'we_enrollment_status_checked'
         -- NO cuentan: retirado, cambiado de curso y REPROGRAMADO. El RP es el
         -- registro de la edicion que el alumno DEJO (su venta vive en el ACT
         -- destino, en otra edicion). "Si es RP no se cuenta" (confirmado negocio).
         AND (cts.alias IS NULL OR cts.alias NOT IN (
                'we_enrollment_status_retired',
                'we_enrollment_status_course_changed',
                'we_enrollment_status_reprogrammed'
              ))
         -- Los dos filtros de abajo miran al PADRE para decidir si el alumno se
         -- fue con el. Solo valen cuando el padre es un PAQUETE. Si el vinculo
         -- es un CAMBIO DE CURSO (padre = la inscripcion que dejo), el alumno se
         -- movio JUSTAMENTE porque su curso viejo se cayo: su venta cuenta en la
         -- edicion nueva. Sin esta guarda, un CC que sale de una edicion
         -- cancelada (A5) desaparecia del comercial mientras sus hijos SEG si
         -- contaban en el aula => la fila descuadraba en 1 (caso 15905:
         -- ESP. FRONT END E8-26 A5 -> ESP. PYTHON DATA SCIENCE E11-26).
         AND (
           EXISTS (SELECT 1 FROM public.course_changes ccp
                    WHERE ccp.enrollment_destination_id = e.enrollment_id
                      AND ccp.enrollment_origin_id = e.parent_enrollment_id)
           -- HIJO de un padre RP: el diploma se reprogramo a otra edicion, asi que
           -- este modulo tampoco asiste aqui (se fue con el padre). Lo excluye del
           -- AULA tambien, no solo del comercial => aula y comercial cuadran.
           OR ((parcts.alias IS NULL OR parcts.alias <> 'we_enrollment_status_reprogrammed')
           -- HIJO de un padre cuya EDICION esta CANCELADA (A5): el diploma se cayo,
           -- el alumno quedo VARADO y su caso vive en el modulo Reprogramaciones
           -- hasta que academica le asigne destino. No asiste a esta aula: ni AULA
           -- ni comercial. (El padre A5 mismo no aparece: su fila es la edicion A5.)
               AND (parseg.alias IS NULL OR parseg.alias <> 'we_segment_a5'))
         )
    )
    SELECT
      edition_num_id,
      -- A) comercial
      COUNT(*) FILTER (WHERE comm_bucket = 'VENTAS')::int AS cnt_ventas,
      COUNT(*) FILTER (WHERE comm_bucket = 'SEGUI')::int  AS cnt_segui,
      COUNT(*) FILTER (WHERE comm_bucket = 'MEMB')::int   AS cnt_memb,
      COUNT(*) FILTER (WHERE comm_bucket = 'BECA')::int   AS cnt_becas,
      COUNT(*) FILTER (WHERE comm_bucket = 'B2B')::int    AS cnt_b2b,
      -- B) aula (headcount del salon): hojas no-beca; cnt_total incluye becas.
      COUNT(*) FILTER (WHERE is_leaf AND NOT is_beca_leaf)::int AS cnt_aula,
      COUNT(*) FILTER (WHERE is_leaf)::int                AS cnt_total
      FROM roster
     GROUP BY edition_num_id
  `, [ids])
    return rows
  }

  // Conteo de CONSULTAS (leads) por edicion para el cronograma.
  //
  // Lista BLANCA a proposito: antes era una lista negra de tres estados
  // (Desestimado/Cerrado/Indiferente) y por eso el cronograma contaba de mas
  // frente a Comercial — se colaban Eliminado, Prox. Inicio e Inscrito. La
  // ESP. EN PYTHON E11-26 marcaba 203 aqui y 191 en Comercial: los 12 de la
  // diferencia eran leads Eliminados. Un estado nuevo en el catalogo NO debe
  // empezar a contar solo por existir; se agrega aca a mano.
  async classroomLeadsCountList (ids) {
    const { rows } = await this.db.query(`
    SELECT l.program_edition_id AS edition_num_id, COUNT(*)::int AS cnt_consultas
      FROM public.leads l
      JOIN public."catalog" cs ON cs.catalog_id = l.cat_status_lead
     WHERE l.program_edition_id = ANY($1::int[])
       AND l.active = 'Y'
       AND cs.alias = ANY($2::text[])
     GROUP BY l.program_edition_id
  `, [ids, LEAD_STATUSES_CONSULTA])
    return rows
  }

  // Listado de alumnos matriculados (FICO-aprobados) en una edicion/aula.
  // Misma elegibilidad que classroomMetricsList; ordenado por apellido, con un
  // contacto vigente de telefono/email y la modalidad de inscripcion. Incluye
  // los campos de la Lista de Notas: ocupacion (P/E), certificado, B2B,
  // usuario de plataforma y estado financiero del enrollment vendido (LATERAL
  // fin, espejo de classroom-export.repository.js).
  async classroomStudentsList (id) {
    const { rows } = await this.db.query(`
    SELECT e.enrollment_id,
           per.person_id,
           per.document_number                          AS dni,
           TRIM(BOTH FROM concat_ws(' ', per.first_name, per.last_name, per.mother_last_name)) AS full_name,
           per.first_name,
           per.last_name,
           per.mother_last_name,
           cts.alias                                    AS type_status_alias,
           cts.description                              AS type_status_label,
           cim.alias                                    AS modality_alias,
           cim.description                              AS modality_label,
           contact_phone.value                          AS phone,
           contact_email.value                          AS email,
           e.registration_date::date                    AS enrolled_on,
           c_prof.alias                                 AS profile_alias,
           (ccert.alias = 'we_certificate_status_paid') AS has_certificate,
           -- B2B: MISMA regla que comm_bucket del cronograma (isB2bSaleSql),
           -- mirando el enrollment VENDIDO (el padre si es hijo de paquete). Sin
           -- esto la Lista de Notas y el modal no cuadran con el contador
           -- (fix 17/07 por el canal, 07/09 por el documento).
           (${isB2bSaleSql({
             doctype: 'COALESCE(e.cat_b2b_doctype, e_sold.cat_b2b_doctype)',
             origin: 'COALESCE(e_sold.agent_origin, e.agent_origin)',
             advisor: 'usold.alias'
           })}) AS is_b2b,
           -- BECA: la venta (enrollment vendido) va en total 0 y no trae ni
           -- documento ni canal B2B ni membresia. Espejo del LATERAL bec del
           -- cronograma, incluido el porque de ser mas ancho que is_b2b.
           -- La membresia gana (si la persona es socia, es MEMB, no beca).
           -- Destino RP/CC (venta ficticia en 0, la real vive en el origen) no es
           -- beca: ni el destino ni sus hijos SEG.
           (COALESCE(e.cat_b2b_doctype, e_sold.cat_b2b_doctype) IS NULL
            AND COALESCE(e_sold.agent_origin, e.agent_origin, '') NOT ILIKE '%b2b%'
            AND COALESCE(e_sold.total_amount, e.total_amount, 0) = 0
            AND mem.tier_name IS NULL
            -- tier grabado en la propia venta: la membresia puede vivir en otra
            -- fila de persons (venta sin DNI => persona nueva) y mem.tier_name
            -- daria NULL. Un curso vendido con membresia NUNCA es beca.
            AND COALESCE(e_sold.membership_program_id, e.membership_program_id) IS NULL
            AND COALESCE(e_sold.notes, '') NOT ILIKE '%desde inscripcion #%'
            AND NOT EXISTS (SELECT 1 FROM public.course_changes ccx
                             WHERE ccx.enrollment_destination_id = e_sold.enrollment_id)) AS is_beca,
           COALESCE(e_sold.agent_origin, e.agent_origin) AS agent_origin,
           -- Codigo del asesor (ej. AE30): misma cascada que la columna AGENTE
           -- del panel FICO: quien solicito el token de pago > asesor de la venta.
           COALESCE(NULLIF(TRIM(tok.alias), ''), usold.alias) AS agent_code,
           -- Codigo del programa padre al que pertenece el alumno (solo hijos).
           CASE WHEN e.parent_enrollment_id IS NOT NULL
                THEN pv_sold.version_code END            AS parent_code,
           odoo_src.odoo_email                          AS odoo_email_stored,
           odoo_src.odoo_user_id                        AS odoo_user_id,
           COALESCE(prog_sold.is_membership, false)     AS is_member,
           -- Membresia del alumno (persona) en ventas FICO: tier vigente y flag.
           COALESCE(mem.tier_name, pv_memb.abbreviation) AS membership_tier_name,
           (COALESCE(mem.tier_name, pv_memb.abbreviation) IS NOT NULL) AS membership_active,
           -- MEMB del cronograma: membresia vigente que REGALA cursos (WE
           -- BLACK/GOLD/PLAT). EXCLUYE 'MEMBRESIA PLUS' — un socio PLUS que
           -- lleva un curso es VENTA/SEGUI real, no MEMB. Mismo EXISTS que
           -- comm_bucket (fix 17/07: el modal del cronograma-vista contaba 6
           -- MEM donde el cronograma contaba 4).
           EXISTS (
             SELECT 1
               FROM public.enrollments em2
               JOIN public.customers cm2         ON cm2.customer_id = em2.customer_id
               JOIN public.program_versions pvm2 ON pvm2.program_version_id = em2.program_version_id
               JOIN public.programs pm2          ON pm2.program_id = pvm2.program_id AND pm2.is_membership = true
                                                 AND UPPER(TRIM(pm2.program_name)) <> 'MEMBRESIA PLUS'
               JOIN public."catalog" cfm2        ON cfm2.catalog_id = em2.cat_fico_status AND cfm2.alias = 'we_enrollment_status_checked'
              WHERE cm2.person_id = per.person_id AND em2.active = 'Y'
           ) OR EXISTS (
             -- tier grabado en la venta (ver is_beca): cubre al socio cuya
             -- membresia quedo en otra fila de persons.
             SELECT 1 FROM public.programs pmv
              WHERE pmv.program_id = COALESCE(e_sold.membership_program_id, e.membership_program_id)
                AND pmv.is_membership = true
                AND UPPER(TRIM(pmv.program_name)) <> 'MEMBRESIA PLUS'
           )                                            AS member_benefits,
           -- Promo LAPTOP: el descuento vive en el enrollment vendido (padre si
           -- es hijo de paquete). Mismo criterio que la etiqueta del panel FICO.
           EXISTS (
             SELECT 1 FROM public.enrollment_discounts edx
               JOIN public.discounts dx ON dx.discount_id = edx.discount_id
              WHERE edx.enrollment_id = COALESCE(e.parent_enrollment_id, e.enrollment_id)
                AND dx.description ILIKE '%laptop%'
           )                                            AS has_laptop_promo,
           fin.fin_total,
           fin.fin_paid,
           fin.fin_overdue
      FROM public.enrollments e
      JOIN public.customers cust ON cust.customer_id = e.customer_id
      JOIN public.persons per    ON per.person_id    = cust.person_id
      JOIN public."catalog" cf   ON cf.catalog_id    = e.cat_fico_status
 LEFT JOIN public."catalog" cts  ON cts.catalog_id   = e.cat_type_status
 LEFT JOIN public."catalog" cim  ON cim.catalog_id   = e.cat_inscription_modality
 LEFT JOIN public."catalog" c_prof ON c_prof.catalog_id = e.cat_profile_id
 LEFT JOIN public."catalog" ccert  ON ccert.catalog_id  = e.cat_certificate_status
 LEFT JOIN public.enrollments e_sold ON e_sold.enrollment_id = COALESCE(e.parent_enrollment_id, e.enrollment_id)
 LEFT JOIN public."catalog" cts_sold ON cts_sold.catalog_id = e_sold.cat_type_status
 -- segmento de la edicion de la venta: un padre A5 (diploma cancelado) deja a
 -- sus modulos varados, fuera de esta aula (ver WHERE).
 LEFT JOIN public.program_editions pe_sold ON pe_sold.edition_num_id = e_sold.program_edition_id
 LEFT JOIN public."catalog" seg_sold ON seg_sold.catalog_id = pe_sold.cat_segment
 -- asesor de la venta: el codigo B2B (NY12/JF39) vive en users.alias.
 LEFT JOIN public.users usold ON usold.user_id = COALESCE(e_sold.seller_agent_id, e.seller_agent_id)
 -- agente que solicito el primer token de pago de la venta (padre si es hijo):
 -- FICO lo prioriza sobre el seller_agent para su columna AGENTE.
 LEFT JOIN LATERAL (
        SELECT u.alias
          FROM public.payment_tokens pt
          LEFT JOIN public.users u ON u.user_id = COALESCE(pt.requested_by, pt.created_by)
         WHERE pt.enrollment_id = COALESCE(e.parent_enrollment_id, e.enrollment_id)
         ORDER BY pt.token_id ASC
         LIMIT 1
      ) tok ON TRUE
 LEFT JOIN public.program_versions pv_sold ON pv_sold.program_version_id = e_sold.program_version_id
 LEFT JOIN public.programs prog_sold ON prog_sold.program_id = pv_sold.program_id
 LEFT JOIN LATERAL (
        -- Acceso Odoo del alumno: el correo de campus puede vivir en otra
        -- inscripcion de la misma persona (FICO lo reusa por persona).
        -- Prioriza filas con odoo_email guardado; si solo hay odoo_user_id,
        -- el correo se sintetiza en JS (misma regla que el panel FICO).
        SELECT NULLIF(TRIM(e2.odoo_email), '') AS odoo_email,
               e2.odoo_user_id
          FROM public.enrollments e2
          JOIN public.customers c2 ON c2.customer_id = e2.customer_id
         WHERE c2.person_id = per.person_id
           AND (NULLIF(TRIM(e2.odoo_email), '') IS NOT NULL OR e2.odoo_user_id IS NOT NULL)
         ORDER BY (NULLIF(TRIM(e2.odoo_email), '') IS NOT NULL) DESC,
                  (e2.enrollment_id = e.enrollment_id) DESC,
                  e2.enrollment_id DESC
         LIMIT 1
      ) odoo_src ON TRUE
 LEFT JOIN LATERAL (
        -- Estado financiero sobre el enrollment "vendido" (padre si es hijo de
        -- paquete, propio si es standalone): cuotas pagadas y vencidas.
        SELECT
          ef.total_amount AS fin_total,
          (SELECT COALESCE(SUM(pi.amount), 0)
             FROM public.payment_installments pi
             JOIN public."catalog" cs ON cs.catalog_id = pi.cat_status
            WHERE pi.enrollment_id = ef.enrollment_id
              AND cs.alias IN ('we_inst_paid', 'we_payment_status_paid')
          ) AS fin_paid,
          (SELECT COUNT(*)::int
             FROM public.payment_installments pi
             JOIN public."catalog" cs ON cs.catalog_id = pi.cat_status
            WHERE pi.enrollment_id = ef.enrollment_id
              AND pi.installment_number > 0
              AND pi.due_date < CURRENT_DATE
              AND cs.alias NOT IN ('we_inst_paid', 'we_payment_status_paid')
          ) AS fin_overdue
          FROM public.enrollments ef
         WHERE ef.enrollment_id = COALESCE(e.parent_enrollment_id, e.enrollment_id)
      ) fin ON TRUE
 LEFT JOIN LATERAL (
        -- "Member" en aulas = la persona tiene una membresia ACTIVA en ventas
        -- FICO: inscripcion a un programa is_membership, confirmada por FICO
        -- (we_enrollment_status_checked) y vigente (active='Y'). El tier (WE PLUS/
        -- GOLD/PLAT/BLACK) sale de la abreviatura. Si hay varias (upgrade), se
        -- toma la mas reciente. "pending" no cuenta: aun no es venta confirmada.
        SELECT pv_m.abbreviation AS tier_name
          FROM public.enrollments em
          JOIN public.customers c_m ON c_m.customer_id = em.customer_id
          JOIN public.program_versions pv_m ON pv_m.program_version_id = em.program_version_id
          JOIN public.programs prog_m ON prog_m.program_id = pv_m.program_id AND prog_m.is_membership = true
          JOIN public."catalog" cf_m ON cf_m.catalog_id = em.cat_fico_status
         WHERE c_m.person_id = per.person_id
           AND em.active = 'Y'
           AND cf_m.alias = 'we_enrollment_status_checked'
         ORDER BY em.enrollment_id DESC
         LIMIT 1
      ) mem ON TRUE
 LEFT JOIN LATERAL (
        -- Etiqueta del tier cuando solo lo sabemos por la venta
        -- (enrollments.membership_program_id) y no por la persona.
        SELECT pvx.abbreviation
          FROM public.program_versions pvx
         WHERE pvx.program_id = COALESCE(e_sold.membership_program_id, e.membership_program_id)
         ORDER BY pvx.program_version_id DESC LIMIT 1
      ) pv_memb ON TRUE
 LEFT JOIN LATERAL (
        SELECT pc.value
          FROM public.person_contacts pc
          JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact
                                 AND c.alias = 'we_way_contact_phone'
         WHERE pc.person_id = per.person_id AND pc.active = 'Y'
         ORDER BY pc.registration_date DESC LIMIT 1
      ) contact_phone ON TRUE
 LEFT JOIN LATERAL (
        SELECT pc.value
          FROM public.person_contacts pc
          JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact
                                 AND c.alias = 'we_way_contact_email'
         WHERE pc.person_id = per.person_id AND pc.active = 'Y'
         ORDER BY pc.registration_date DESC LIMIT 1
      ) contact_email ON TRUE
     WHERE e.program_edition_id = $1
       AND e.active = 'Y'
       AND cf.alias = 'we_enrollment_status_checked'
       -- Los que salieron del aula (retiro / cambio de curso / reprogramado) ya
       -- no van en la lista activa; quedan en el Historial. RP y sus hijos se
       -- excluyen igual que en el contador del cronograma (se fueron con el
       -- diploma a otra edicion) => cronograma y Lista de Notas cuadran.
       AND (cts.alias IS NULL OR cts.alias NOT IN (
              'we_enrollment_status_retired',
              'we_enrollment_status_course_changed',
              'we_enrollment_status_reprogrammed'
            ))
       AND (cts_sold.alias IS NULL OR cts_sold.alias <> 'we_enrollment_status_reprogrammed')
       -- HIJO de un padre cuya EDICION esta CANCELADA (A5): el diploma se cayo y
       -- el alumno quedo VARADO; su caso vive en el modulo Reprogramaciones hasta
       -- que academica le asigne destino, no asiste a esta aula. Solo aplica al
       -- hijo: si la edicion A5 es la propia, se esta viendo su lista y ahi si van.
       AND (e.parent_enrollment_id IS NULL
            OR seg_sold.alias IS NULL OR seg_sold.alias <> 'we_segment_a5')
       -- HOJA = sin hijos (un destino de CC hacia paquete tiene padre Y hijos:
       -- asisten sus hijos, no el). Misma regla que classroomMetricsList.
       AND NOT EXISTS (
              SELECT 1 FROM public.enrollments c
               WHERE c.parent_enrollment_id = e.enrollment_id
            )
     ORDER BY per.last_name, per.first_name, e.enrollment_id
  `, [id])
    // platform_user: misma resolucion que el panel FICO (getEnrollmentFlags):
    // odoo_email guardado > sintetizado apellido.nombre@dominio si existe
    // cuenta Odoo (odoo_user_id) > correo de contacto registrado.
    const students = rows.map((r) => {
      const { odoo_email_stored, odoo_user_id, ...rest } = r
      let platformUser = (odoo_email_stored || '').trim() || null
      if (!platformUser && odoo_user_id) {
        const { base, domain } = buildOdooEmailBase(r.first_name, r.last_name)
        platformUser = `${base}${domain}`
      }
      return { ...rest, platform_user: platformUser || r.email || null }
    })
    // Una misma persona puede caer dos veces en el aula como hijo de dos
    // paquetes distintos (p.ej. DIP y ESP de Finanzas comparten el curso):
    // se muestra una sola fila y todos sus codigos padre en parent_codes.
    const byPerson = new Map()
    for (const s of students) {
      const prev = byPerson.get(s.person_id)
      if (!prev) {
        s.parent_codes = s.parent_code ? [s.parent_code] : []
        byPerson.set(s.person_id, s)
      } else if (s.parent_code && !prev.parent_codes.includes(s.parent_code)) {
        prev.parent_codes.push(s.parent_code)
      }
    }
    return [...byPerson.values()]
  }

  // Historial del aula: alumnos que estuvieron matriculados en esta edicion pero
  // ya NO figuran en la lista activa (Notas). Complemento de classroomStudentsList:
  // retiros, cambios de curso (la matricula origen conserva program_edition_id),
  // reprogramaciones/observados, bajas manuales (active='N') o FICO no confirmado.
  // Cada fila trae la ultima accion de enrollment_audit_log (fecha/usuario/motivo)
  // para responder "cuando y por que salio".
  async classroomStudentsHistory (id) {
    const { rows } = await this.db.query(`
    SELECT e.enrollment_id,
           per.document_number                          AS dni,
           TRIM(BOTH FROM concat_ws(' ', per.first_name, per.last_name, per.mother_last_name)) AS full_name,
           per.first_name,
           per.last_name,
           per.mother_last_name,
           cts.alias                                    AS type_status_alias,
           cts.description                              AS type_status_label,
           cf.alias                                     AS fico_status_alias,
           cf.description                               AS fico_status_label,
           e.active,
           e.registration_date::date                    AS enrolled_on,
           al.action                                    AS last_action,
           al.performed_at                              AS left_at,
           al.justificacion                             AS justificacion,
           usr.alias                                    AS performed_by
      FROM public.enrollments e
      JOIN public.customers cust ON cust.customer_id = e.customer_id
      JOIN public.persons per    ON per.person_id    = cust.person_id
      JOIN public."catalog" cf   ON cf.catalog_id    = e.cat_fico_status
 LEFT JOIN public."catalog" cts  ON cts.catalog_id   = e.cat_type_status
 LEFT JOIN LATERAL (
        -- Ultima accion registrada para esta inscripcion (el retiro / cambio /
        -- baja queda como la mas reciente). Best-effort: puede no existir.
        SELECT a.action, a.performed_at, a.justificacion, a.performed_by
          FROM public.enrollment_audit_log a
         WHERE a.enrollment_id = e.enrollment_id
         ORDER BY a.performed_at DESC
         LIMIT 1
      ) al ON TRUE
 LEFT JOIN public.users usr ON usr.user_id = al.performed_by
     WHERE (
            e.program_edition_id = $1
            -- ...o fue REPROGRAMADA fuera de esta aula por el flujo RP antiguo,
            -- que movia la fila a otra edicion (ya no matchea program_edition_id);
            -- el vinculo con el aula origen quedo en el audit log (old_edition_id).
            -- El flujo RP actual deja la fila origen en su edicion (matchea arriba).
         OR e.enrollment_id IN (
              SELECT a.enrollment_id
                FROM public.enrollment_audit_log a
               WHERE a.action = 'edition_reprogrammed'
                 AND (a.changes->>'old_edition_id') = $1::text
            )
       )
       AND (
            e.active = 'N'
         OR cts.alias IN (
              'we_enrollment_status_retired',
              'we_enrollment_status_course_changed',
              'we_enrollment_status_reprogrammed'
            )
       )
       -- Excluir si la persona AUN tiene una matricula vigente en esta misma
       -- aula: son filas duplicadas/migracion, no alumnos que se fueron.
       AND NOT EXISTS (
            SELECT 1
              FROM public.enrollments e2
              JOIN public.customers cu2 ON cu2.customer_id = e2.customer_id
             WHERE e2.program_edition_id = e.program_edition_id
               AND cu2.person_id = per.person_id
               AND e2.active = 'Y'
               AND e2.enrollment_id <> e.enrollment_id
       )
     ORDER BY al.performed_at DESC NULLS LAST, per.last_name, per.first_name
  `, [id])
    return rows
  }

  // CONVALIDADOS de esta aula: alumnos que compraron el PADRE (paquete) pero NO
  // tienen matricula aqui porque el modulo se les convalido — ya lo llevaron
  // antes. No es un hueco de datos: la convalidacion vive en
  // enrollment_validations y buildEditionPlan (validation.entity.js) se salta ese
  // hijo al crear los SEG. Por eso el aula cuenta uno menos que las ventas del
  // padre y Academica no los ve por ningun lado.
  //
  // Que aula le tocaba se resuelve por edition_structure (padre -> hijos); el
  // curso convalidado, por program_version (ev.child_version_id = el de ESTA
  // edicion). Solo se listan los que TIENEN registro de convalidacion: un hijo
  // faltante sin fila en enrollment_validations es un error de datos y no debe
  // disfrazarse de convalidacion (decision de negocio, 2026-08-03).
  // ponytail: un padre E0 (program_edition_id NULL) no tiene arbol, asi que sus
  // convalidaciones no se pueden atribuir a un aula y no salen aqui.
  async classroomValidatedList (id) {
    const { rows } = await this.db.query(`
    SELECT ev.validation_id,
           p.enrollment_id                              AS parent_enrollment_id,
           per.person_id,
           per.document_number                          AS dni,
           TRIM(BOTH FROM concat_ws(' ', per.first_name, per.last_name, per.mother_last_name)) AS full_name,
           per.first_name,
           per.last_name,
           per.mother_last_name,
           pv_par.abbreviation                          AS parent_program_name,
           -- codigo como lo lee Academica ("E5-26"), no el global interno.
           COALESCE(NULLIF(pe_par.specific_code, ''), pe_par.global_code) AS parent_edition_code,
           ev.notes                                     AS validation_notes,
           ev.created_at                                AS validated_at,
           -- ASESOR de la venta del paquete, con el mismo criterio que la Lista
           -- de Notas (agent_code): manda quien pidio el token de pago sobre
           -- seller_agent_id, porque una inscripcion nacida de token queda
           -- grabada a nombre del usuario FICO que la confirmo, no del comercial.
           COALESCE(NULLIF(TRIM(tok.alias), ''), usr_sell.alias, p.agent_origin) AS agent_code,
           prev.enrollment_id                           AS prev_enrollment_id,
           prev.edition_code                            AS prev_edition_code,
           prev.start_date                              AS prev_start_date,
           prev.end_date                                AS prev_end_date
      FROM public.enrollment_validations ev
      -- el padre: la venta del paquete, vigente y FICO-aprobada
      JOIN public.enrollments p        ON p.enrollment_id = ev.enrollment_id AND p.active = 'Y'
      JOIN public."catalog" cfp        ON cfp.catalog_id = p.cat_fico_status
                                      AND cfp.alias = 'we_enrollment_status_checked'
 LEFT JOIN public."catalog" ctsp       ON ctsp.catalog_id = p.cat_type_status
      JOIN public.customers cust       ON cust.customer_id = p.customer_id
      JOIN public.persons per          ON per.person_id = cust.person_id
 LEFT JOIN public.program_versions pv_par ON pv_par.program_version_id = p.program_version_id
 LEFT JOIN public.program_editions pe_par ON pe_par.edition_num_id = p.program_edition_id
 LEFT JOIN public.users usr_sell      ON usr_sell.user_id = p.seller_agent_id
 LEFT JOIN LATERAL (
        SELECT u.alias
          FROM public.payment_tokens pt
          LEFT JOIN public.users u ON u.user_id = COALESCE(pt.requested_by, pt.created_by)
         WHERE pt.enrollment_id = p.enrollment_id
         ORDER BY pt.token_id ASC
         LIMIT 1
      ) tok ON TRUE
      -- esta aula tiene que colgar del arbol de la edicion del padre...
      JOIN public.edition_structure es ON es.parent_edition_id = p.program_edition_id
                                      AND es.child_edition_id = $1
      -- ...y la convalidacion tiene que ser de ESTE curso (misma program_version)
      JOIN public.program_editions pe  ON pe.edition_num_id = es.child_edition_id
                                      AND pe.program_version_id = ev.child_version_id
      -- donde SI lo llevo: otra edicion del mismo curso, suya y aprobada. Se
      -- prefiere una anterior a esta aula; si solo hay posteriores, se muestra esa.
 LEFT JOIN LATERAL (
        SELECT e2.enrollment_id,
               COALESCE(NULLIF(pe2.specific_code, ''), pe2.global_code) AS edition_code,
               pe2.start_date, pe2.end_date
          FROM public.enrollments e2
          JOIN public.customers cu2        ON cu2.customer_id = e2.customer_id
          JOIN public.program_editions pe2 ON pe2.edition_num_id = e2.program_edition_id
          JOIN public."catalog" cf2        ON cf2.catalog_id = e2.cat_fico_status
                                          AND cf2.alias = 'we_enrollment_status_checked'
         WHERE cu2.person_id = per.person_id
           AND pe2.program_version_id = pe.program_version_id
           AND pe2.edition_num_id <> pe.edition_num_id
           AND e2.active = 'Y'
         ORDER BY (pe2.start_date < pe.start_date) DESC, pe2.start_date DESC
         LIMIT 1
      ) prev ON TRUE
     WHERE COALESCE(ev.validation_type, 'same_edition') <> 'edition_override'
       -- el padre sigue vivo en su aula: si se retiro / cambio / reprogramo, su
       -- convalidacion ya no pinta nada aqui (mismo criterio que el contador).
       AND (ctsp.alias IS NULL OR ctsp.alias NOT IN (
              'we_enrollment_status_retired',
              'we_enrollment_status_course_changed',
              'we_enrollment_status_reprogrammed'
            ))
       -- guarda: si pese a la convalidacion tiene matricula viva en esta aula,
       -- entonces SI asiste y va en la lista activa, no aqui.
       AND NOT EXISTS (
              SELECT 1
                FROM public.enrollments e3
                JOIN public.customers cu3 ON cu3.customer_id = e3.customer_id
               WHERE e3.program_edition_id = $1
                 AND cu3.person_id = per.person_id
                 AND e3.active = 'Y'
            )
     ORDER BY per.last_name, per.first_name
  `, [id])
    return rows
  }

  // Crea la tabla classroom_audit_rubric si no existe (auto-migracion idempotente),
  // para que el deploy no dependa de correr migraciones manuales. Tras la primera
  // verificacion exitosa se cachea en memoria y las siguientes llamadas la saltan.
  async ensureRubricTable () {
    if (this._rubricTableReady) return
    await this.db.query(`
    CREATE TABLE IF NOT EXISTS public.classroom_audit_rubric (
      rubric_id          SERIAL PRIMARY KEY,
      program_edition_id INTEGER NOT NULL REFERENCES public.program_editions(edition_num_id) ON DELETE CASCADE,
      session_number     INTEGER NOT NULL CHECK (session_number > 0),
      criteria           JSONB NOT NULL DEFAULT '{}'::jsonb,
      ai_report          JSONB,
      ai_metadata        JSONB,
      ai_generated_at    TIMESTAMPTZ,
      updated_by         INTEGER REFERENCES public.users(user_id),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (program_edition_id, session_number)
    );
    CREATE INDEX IF NOT EXISTS idx_car_edition
      ON public.classroom_audit_rubric (program_edition_id);
    ALTER TABLE public.classroom_audit_rubric
      ADD COLUMN IF NOT EXISTS ai_report JSONB,
      ADD COLUMN IF NOT EXISTS ai_metadata JSONB,
      ADD COLUMN IF NOT EXISTS ai_generated_at TIMESTAMPTZ;
  `)
    this._rubricTableReady = true
  }

  // Resumen agregado de auditoria por aula: cobertura manual/IA y promedios /20
  // por edicion. La consolidacion final se hace en frontend.
  async classroomAuditSummaryList (ids) {
    await this.ensureRubricTable()
    const { rows } = await this.db.query(`
    WITH per_session AS (
      SELECT
        car.program_edition_id,
        car.session_number,
        car.updated_at,
        car.ai_generated_at,
        (SELECT COUNT(*) FROM jsonb_each(car.criteria) WHERE value::boolean = true)::int
          AS manual_marked,
        CASE
          WHEN car.ai_report IS NOT NULL
           AND (car.ai_report #>> '{metricas_rapidas,puntuacion_global}') ~ '^[0-9]+(\\.[0-9]+)?$'
          THEN (car.ai_report #>> '{metricas_rapidas,puntuacion_global}')::numeric * 4
          ELSE NULL
        END AS ai_score20
      FROM public.classroom_audit_rubric car
      WHERE car.program_edition_id = ANY($1::int[])
    )
    SELECT
      program_edition_id                                                       AS edition_num_id,
      COUNT(*) FILTER (WHERE manual_marked > 0)::int                            AS sessions_manual,
      COUNT(*) FILTER (WHERE ai_score20 IS NOT NULL)::int                       AS sessions_ai,
      ROUND(AVG((manual_marked::numeric / 20.0) * 20.0)
        FILTER (WHERE manual_marked > 0)::numeric, 2)                           AS manual_avg_20,
      ROUND(AVG(ai_score20)
        FILTER (WHERE ai_score20 IS NOT NULL)::numeric, 2)                      AS ai_avg_20,
      MAX(GREATEST(updated_at, COALESCE(ai_generated_at, '-infinity'::timestamptz)))
                                                                                AS last_activity_at
    FROM per_session
    GROUP BY program_edition_id
  `, [ids])
    return rows
  }

  // Consulta ligera compartida por Reporte Academico, Aulas y el header de
  // AulaDetail (editionId): solo cursos, solo las columnas que esas vistas
  // usan, con resumen de auditoria + conteo de alumnos + horario unidos en la
  // misma pasada. Existe porque sp_edition_list tarda 15s+ y pesa ~3MB
  // (tree_detail, schedules) contra la BD remota; esta baja eso a ~1s/~300KB.
  // La etiqueta cat_segment replica la logica del SP (A5/A6/A1/A2) para que
  // la exclusion de cancelados en frontend siga funcionando igual.
  async academicReportList ({ editionId = null } = {}) {
    await this.ensureRubricTable()
    const params = []
    let where = "WHERE cat.alias = 'we_program_type_course'"
    if (Number.isFinite(editionId)) {
      params.push(editionId)
      where += ' AND pe.edition_num_id = $1'
    }
    const { rows } = await this.db.query(`
    WITH ec AS (
      SELECT pv.program_id, COUNT(*) AS total_editions
      FROM public.program_editions pe
      JOIN public.program_versions pv ON pe.program_version_id = pv.program_version_id
      GROUP BY pv.program_id
    ),
    audit AS (
      SELECT
        s.program_edition_id,
        COUNT(*) FILTER (WHERE s.manual_marked > 0)::int      AS sessions_manual,
        COUNT(*) FILTER (WHERE s.ai_score20 IS NOT NULL)::int AS sessions_ai,
        ROUND(AVG((s.manual_marked::numeric / 20.0) * 20.0)
          FILTER (WHERE s.manual_marked > 0)::numeric, 2)     AS manual_avg_20,
        ROUND(AVG(s.ai_score20)
          FILTER (WHERE s.ai_score20 IS NOT NULL)::numeric, 2) AS ai_avg_20,
        MAX(GREATEST(s.updated_at, COALESCE(s.ai_generated_at, '-infinity'::timestamptz)))
                                                              AS last_activity_at
      FROM (
        SELECT car.program_edition_id, car.updated_at, car.ai_generated_at,
          (SELECT COUNT(*) FROM jsonb_each(car.criteria) WHERE value::boolean = true)::int
            AS manual_marked,
          CASE
            WHEN car.ai_report IS NOT NULL
             AND (car.ai_report #>> '{metricas_rapidas,puntuacion_global}') ~ '^[0-9]+(\\.[0-9]+)?$'
            THEN (car.ai_report #>> '{metricas_rapidas,puntuacion_global}')::numeric * 4
            ELSE NULL
          END AS ai_score20
        FROM public.classroom_audit_rubric car
      ) s
      GROUP BY s.program_edition_id
    ),
    st AS (
      SELECT e.program_edition_id, COUNT(*)::int AS students
      FROM public.enrollments e
      JOIN public.catalog cf ON cf.catalog_id = e.cat_fico_status
      WHERE e.active = 'Y'
        AND cf.alias = 'we_enrollment_status_checked'
        AND NOT EXISTS (SELECT 1 FROM public.enrollments c
                        WHERE c.parent_enrollment_id = e.enrollment_id)
      GROUP BY e.program_edition_id
    )
    SELECT
      pe.edition_num_id,
      pe.global_code,
      pe.specific_code,
      pv.version_code,
      pv.abbreviation  AS program_abreviature,
      pv.sessions      AS program_sessions,
      cotm.description AS cat_model_modality_label,
      INITCAP(CONCAT(per.first_name, ' ', per.last_name)) AS instructor,
      pe.active,
      pe.start_date,
      pe.end_date,
      dayc.description  AS day_combination_label,
      hourc.description AS hour_combination_label,
      st.students,
      COALESCE(cota.description,
        CASE WHEN pe.active = 'N' THEN 'A5'
             WHEN COALESCE(ec.total_editions, 0) <= 2 THEN 'A6'
             WHEN NOT EXISTS (SELECT 1 FROM public.edition_structure es
                              WHERE es.child_edition_id = pe.edition_num_id) THEN 'A1'
             ELSE 'A2' END) AS cat_segment,
      a.sessions_manual, a.sessions_ai, a.manual_avg_20, a.ai_avg_20, a.last_activity_at
    FROM public.program_editions pe
    JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
    JOIN public.programs p          ON p.program_id = pv.program_id
    JOIN public.catalog cat         ON cat.catalog_id = p.cat_type_program
    JOIN public.catalog cotm        ON cotm.catalog_id = p.cat_model_modality
    LEFT JOIN public.catalog cota   ON cota.catalog_id = pe.cat_segment
    LEFT JOIN public.catalog dayc   ON dayc.catalog_id = pe.cat_day_combination_id
    LEFT JOIN public.catalog hourc  ON hourc.catalog_id = pe.cat_hour_combination_id
    LEFT JOIN public.instructors i  ON i.instructor_id = pe.instructor_id
    LEFT JOIN public.persons per    ON per.person_id = i.person_id
    LEFT JOIN ec      ON ec.program_id = p.program_id
    LEFT JOIN audit a ON a.program_edition_id = pe.edition_num_id
    LEFT JOIN st      ON st.program_edition_id = pe.edition_num_id
    ${where}
  `, params)
    return rows
  }

  // Version SIN agregar de classroomAuditSummaryList: una fila por sesion
  // evaluada de varias aulas. La usa el Seguimiento Docentes, que necesita
  // saber QUE sesion trae auditoria, no cuantas.
  async classroomAuditSessionsList (ids) {
    await this.ensureRubricTable()
    if (!ids.length) return []
    const { rows } = await this.db.query(`
    SELECT car.program_edition_id,
           car.session_number,
           (SELECT COUNT(*) FROM jsonb_each(car.criteria) WHERE value::boolean = true)::int
             AS manual_marked,
           CASE
             WHEN car.ai_report IS NOT NULL
              AND (car.ai_report #>> '{metricas_rapidas,puntuacion_global}') ~ '^[0-9]+(\\.[0-9]+)?$'
             THEN ROUND((car.ai_report #>> '{metricas_rapidas,puntuacion_global}')::numeric * 4, 2)
             ELSE NULL
           END AS ai_score20,
           GREATEST(car.updated_at, COALESCE(car.ai_generated_at, '-infinity'::timestamptz))
             AS audited_at
      FROM public.classroom_audit_rubric car
     WHERE car.program_edition_id = ANY($1::int[])
  `, [ids])
    return rows
  }

  // Carga toda la rubrica de evaluacion de una edicion (una fila por sesion
  // ya evaluada), ordenada por numero de sesion.
  async classroomAuditGet (id) {
    await this.ensureRubricTable()
    const { rows } = await this.db.query(`
    SELECT session_number, criteria, ai_report, ai_metadata, ai_generated_at,
           updated_by, updated_at
      FROM public.classroom_audit_rubric
     WHERE program_edition_id = $1
     ORDER BY session_number
  `, [id])
    return rows
  }

  // Upsert del reporte IA en la fila (edicion, sesion). Preserva los criterios
  // manuales: solo toca ai_report, ai_metadata y ai_generated_at.
  async classroomAuditUpsertAi (eid, sn, report, metadata) {
    await this.ensureRubricTable()
    const { rows } = await this.db.query(`
    INSERT INTO public.classroom_audit_rubric
      (program_edition_id, session_number, ai_report, ai_metadata, ai_generated_at, updated_at)
    VALUES ($1, $2, $3::jsonb, $4::jsonb, NOW(), NOW())
    ON CONFLICT (program_edition_id, session_number) DO UPDATE
       SET ai_report = EXCLUDED.ai_report,
           ai_metadata = EXCLUDED.ai_metadata,
           ai_generated_at = NOW(),
           updated_at = NOW()
    RETURNING session_number, criteria, ai_report, ai_metadata, ai_generated_at, updated_at
  `, [eid, sn, JSON.stringify(report), JSON.stringify(metadata)])
    return rows
  }

  // Upsert atomico de los criterios manuales de una sesion. Reemplaza el JSONB
  // completo (no merge); RETURNING incluye las columnas IA para que el frontend
  // mantenga el panel de analisis visible tras guardar.
  async classroomAuditSave (eid, sn, payload, uid) {
    await this.ensureRubricTable()
    const { rows } = await this.db.query(`
    INSERT INTO public.classroom_audit_rubric
      (program_edition_id, session_number, criteria, updated_by, updated_at)
    VALUES ($1, $2, $3::jsonb, $4, NOW())
    ON CONFLICT (program_edition_id, session_number) DO UPDATE
       SET criteria = EXCLUDED.criteria,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()
    RETURNING session_number, criteria, ai_report, ai_metadata, ai_generated_at,
              updated_by, updated_at
  `, [eid, sn, JSON.stringify(payload), uid])
    return rows
  }

  // Crea la tabla classroom_student_grades si no existe (auto-migracion
  // idempotente, mismo patron que ensureRubricTable). Lista de Notas por
  // alumno: tests/participacion por sesion + proyecto integrador.
  async ensureGradesTable () {
    if (this._gradesTableReady) return
    await this.db.query(`
    CREATE TABLE IF NOT EXISTS public.classroom_student_grades (
      grade_id            SERIAL PRIMARY KEY,
      program_edition_id  INTEGER NOT NULL REFERENCES public.program_editions(edition_num_id) ON DELETE CASCADE,
      enrollment_id       INTEGER NOT NULL REFERENCES public.enrollments(enrollment_id) ON DELETE CASCADE,
      tests               JSONB NOT NULL DEFAULT '{}'::jsonb,
      participation       JSONB NOT NULL DEFAULT '{}'::jsonb,
      partial_criteria    JSONB NOT NULL DEFAULT '{}'::jsonb,
      final_criteria      JSONB NOT NULL DEFAULT '{}'::jsonb,
      test_score          NUMERIC(5,2),
      participation_score NUMERIC(4,2),
      partial_score       NUMERIC(5,2),
      final_deliv_score   NUMERIC(5,2),
      final_grade         NUMERIC(5,2),
      group_number        INTEGER,
      tracking_code       TEXT,
      updated_by          INTEGER REFERENCES public.users(user_id),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (enrollment_id)
    );
    CREATE INDEX IF NOT EXISTS idx_csg_edition
      ON public.classroom_student_grades (program_edition_id);
    ALTER TABLE public.classroom_student_grades
      ADD COLUMN IF NOT EXISTS observation TEXT;
    -- codigo del issued.certificate de Odoo cuando el alumno ya fue certificado
    ALTER TABLE public.classroom_student_grades
      ADD COLUMN IF NOT EXISTS odoo_cert_code TEXT,
      ADD COLUMN IF NOT EXISTS odoo_cert_at TIMESTAMPTZ;
  `)
    this._gradesTableReady = true
  }

  // Vista Semanal Academica: aulas tipo curso, activas y no canceladas (A5),
  // cuyo dictado se solapa con el rango [dateStart, dateEnd] (lunes-domingo
  // de la semana ISO). El nº de sesion por dia se deriva en el entity.
  async weeklySessions (dateStart, dateEnd) {
    const { rows } = await this.db.query(`
    SELECT pe.edition_num_id,
           pe.start_date::date::text AS start_date,
           pe.end_date::date::text   AS end_date,
           pe.cat_day_combination_id,
           pe.specific_code,
           pv.abbreviation,
           pv.sessions               AS total_sessions,
           dayc.description          AS day_label,
           hourc.description         AS hour_label,
           INITCAP(CONCAT_WS(' ', per.first_name, per.last_name)) AS instructor
      FROM public.program_editions pe
      JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
      JOIN public.programs p          ON p.program_id = pv.program_id
      JOIN public."catalog" ctp       ON ctp.catalog_id = p.cat_type_program
                                     AND ctp.alias = 'we_program_type_course'
 LEFT JOIN public."catalog" cseg      ON cseg.catalog_id = pe.cat_segment
 LEFT JOIN public."catalog" dayc      ON dayc.catalog_id = pe.cat_day_combination_id
 LEFT JOIN public."catalog" hourc     ON hourc.catalog_id = pe.cat_hour_combination_id
 LEFT JOIN public.instructors i       ON i.instructor_id = pe.instructor_id
 LEFT JOIN public.persons per         ON per.person_id = i.person_id
     WHERE pe.active = 'Y'
       AND COALESCE(cseg.alias, '') <> 'we_segment_a5'
       AND pe.start_date::date <= $2::date
       AND pe.end_date::date   >= $1::date
     ORDER BY hourc.description NULLS LAST, pv.abbreviation
  `, [dateStart, dateEnd])
    return rows
  }

  // ===================================================================
  // Control de ediciones: overrides de gestion por sesion (estado A/R/T
  // y fecha reprogramada). Tabla lazy-create, mismo patron que grades.
  // ===================================================================
  async ensureSessionControlTable () {
    if (this._sessionControlReady) return
    await this.db.query(`
    CREATE TABLE IF NOT EXISTS public.edition_session_control (
      id                  SERIAL PRIMARY KEY,
      program_edition_id  INTEGER NOT NULL,
      session_number      INTEGER NOT NULL,
      status              VARCHAR(1) CHECK (status IN ('A','R','T')),
      new_date            DATE,
      updated_by          INTEGER REFERENCES public.users(user_id),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (program_edition_id, session_number)
    );
    -- Veces que la sesion cambio de fecha (cada re-reprogramacion suma 1);
    -- el tope por curso se valida en el usecase.
    ALTER TABLE public.edition_session_control
      ADD COLUMN IF NOT EXISTS repro_times INTEGER NOT NULL DEFAULT 0;
  `)
    this._sessionControlReady = true
  }

  // SELECT base del control (mismos joins/filtros que weeklySessions); el
  // WHERE varia entre "inician en la semana" y "una edicion puntual".
  _controlSelect (where) {
    return `
    SELECT pe.edition_num_id,
           pe.start_date::date::text AS start_date,
           pe.end_date::date::text   AS end_date,
           pe.cat_day_combination_id,
           pe.specific_code,
           pv.abbreviation,
           pv.sessions               AS total_sessions,
           dayc.description          AS day_label,
           hourc.description         AS hour_label,
           pe.new_methodology,
           INITCAP(CONCAT_WS(' ', per.first_name, per.last_name)) AS instructor,
           -- Codigo de aula de Nexus (vw_aula_auditoria_resumen_2026): siglas
           -- del curso + fecha de inicio. Dos aulas del mismo curso que abren
           -- el mismo dia se desempatan con las iniciales del docente.
           CASE WHEN dup.n > 1
                THEN UPPER(LEFT(SPLIT_PART(BTRIM(per.first_name), ' ', 1), 1)) ||
                     UPPER(LEFT(SPLIT_PART(BTRIM(per.last_name), ' ', 1), 1))
                ELSE '' END
             || sg.siglas || '-' || TO_CHAR(pe.start_date, 'DD/MM/YY') AS class_code
      FROM public.program_editions pe
      JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
      JOIN public.programs p          ON p.program_id = pv.program_id
      JOIN public."catalog" ctp       ON ctp.catalog_id = p.cat_type_program
                                     AND ctp.alias = 'we_program_type_course'
 LEFT JOIN public."catalog" cseg      ON cseg.catalog_id = pe.cat_segment
 LEFT JOIN public."catalog" dayc      ON dayc.catalog_id = pe.cat_day_combination_id
 LEFT JOIN public."catalog" hourc     ON hourc.catalog_id = pe.cat_hour_combination_id
 LEFT JOIN public.instructors i       ON i.instructor_id = pe.instructor_id
 LEFT JOIN public.persons per         ON per.person_id = i.person_id
CROSS JOIN LATERAL (
             SELECT STRING_AGG(LEFT(w, 1), '') AS siglas
               FROM regexp_split_to_table(UPPER(pv.abbreviation), '\\s+') w
           ) sg
      -- El desempate se cuenta sobre TODA la tabla, no sobre las filas que deja
      -- el WHERE variable: si no, pedir la edicion de a una le cambiaria el codigo.
CROSS JOIN LATERAL (
             SELECT COUNT(*) AS n
               FROM public.program_editions pe2
               JOIN public.program_versions pv2 ON pv2.program_version_id = pe2.program_version_id
              WHERE pv2.abbreviation = pv.abbreviation
                AND pe2.start_date = pe.start_date
                -- Sin docente no hay iniciales que desempaten: la vista de Nexus
                -- tampoco las cuenta (entra por JOIN instructors).
                AND pe2.instructor_id IS NOT NULL
           ) dup
     WHERE pe.active = 'Y'
       AND COALESCE(cseg.alias, '') <> 'we_segment_a5'
       AND ${where}
     ORDER BY pe.start_date, pv.abbreviation`
  }

  // Aulas EN CURSO durante la semana: su dictado se solapa con el rango.
  // ponytail: margen fijo de 45 dias sobre end_date para no perder sesiones
  // reprogramadas mas alla del fin planificado; si un aula se estira mas,
  // derivar el fin real desde los overrides.
  async weeklyControlEditions (dateStart, dateEnd) {
    const { rows } = await this.db.query(
      this._controlSelect(`pe.start_date::date <= $2::date
       AND (pe.end_date::date + INTERVAL '45 days') >= $1::date`),
      [dateStart, dateEnd]
    )
    return rows
  }

  async controlEditionGet (id) {
    const { rows } = await this.db.query(
      this._controlSelect('pe.edition_num_id = $1'), [id]
    )
    return rows[0] || null
  }

  async sessionControlsList (editionIds) {
    await this.ensureSessionControlTable()
    if (!editionIds.length) return []
    const { rows } = await this.db.query(`
    SELECT program_edition_id, session_number, status, new_date::text AS new_date,
           repro_times
      FROM public.edition_session_control
     WHERE program_edition_id = ANY($1::int[])
  `, [editionIds])
    return rows
  }

  // Upsert del override; status null limpia la gestion de esa sesion. Todo
  // cambio deja su rastro en audit_logs (misma transaccion) para que aparezca
  // en el Historial de cambios del aula (sp_audit_logs_get).
  async sessionControlSave ({ edition_num_id, session_number, status, new_date }, uid) {
    await this.ensureSessionControlTable()
    const client = await this.db.connect()
    try {
      await client.query('BEGIN')
      const { rows: prevRows } = await client.query(`
      SELECT program_edition_id, session_number, status,
             new_date::text AS new_date, repro_times
        FROM public.edition_session_control
       WHERE program_edition_id = $1 AND session_number = $2
         FOR UPDATE
    `, [edition_num_id, session_number])
      const prev = prevRows[0] || null
      let curr = null

      if (!status) {
        await client.query(`
        DELETE FROM public.edition_session_control
         WHERE program_edition_id = $1 AND session_number = $2
      `, [edition_num_id, session_number])
      } else {
        const { rows } = await client.query(`
        INSERT INTO public.edition_session_control
          (program_edition_id, session_number, status, new_date, repro_times, updated_by, updated_at)
        VALUES ($1, $2, $3, $4, CASE WHEN $4::date IS NULL THEN 0 ELSE 1 END, $5, NOW())
        ON CONFLICT (program_edition_id, session_number)
        DO UPDATE SET status = EXCLUDED.status,
                      -- Marcar A/T una sesion ya reprogramada conserva su new_date
                      -- (historial de repro); solo Pendiente (DELETE) la limpia.
                      new_date = COALESCE(EXCLUDED.new_date, edition_session_control.new_date),
                      -- Cada CAMBIO real de fecha suma una reprogramacion.
                      repro_times = edition_session_control.repro_times +
                        CASE WHEN EXCLUDED.new_date IS NOT NULL
                              AND EXCLUDED.new_date IS DISTINCT FROM edition_session_control.new_date
                             THEN 1 ELSE 0 END,
                      updated_by = EXCLUDED.updated_by,
                      updated_at = NOW()
        RETURNING program_edition_id, session_number, status,
                  new_date::text AS new_date, repro_times
      `, [edition_num_id, session_number, status, new_date || null, uid ?? null])
        curr = rows[0]
      }

      // Trazabilidad: solo si hubo cambio real (borrar algo inexistente no traza).
      if (prev || curr) {
        const changed = { sesion: { old: session_number, new: session_number } }
        if ((prev?.status ?? null) !== (curr?.status ?? null)) {
          changed.estado_sesion = { old: prev?.status ?? null, new: curr?.status ?? null }
        }
        if ((prev?.new_date ?? null) !== (curr?.new_date ?? null)) {
          changed.fecha_reprogramada = { old: prev?.new_date ?? null, new: curr?.new_date ?? null }
        }
        await client.query(`
        INSERT INTO public.audit_logs
          (table_name, record_id, action, user_id, changed_fields, old_data, new_data, transaction_id)
        VALUES ('edition_session_control', $1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, txid_current())
      `, [
          edition_num_id,
          !prev ? 'INSERT' : (!curr ? 'DELETE' : 'UPDATE'),
          uid ?? null,
          JSON.stringify(changed),
          prev ? JSON.stringify(prev) : null,
          curr ? JSON.stringify(curr) : null
        ])
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  // ===================================================================
  // Cierre de cursos: checklist por aula (mismo patron lazy-create que
  // edition_session_control). Una fila por edicion, no por casilla: el "quien y
  // cuando" de cada marca se reconstruye desde audit_logs.
  // ===================================================================
  async ensureClosureTable () {
    if (this._closureReady) return
    await this.db.query(`
    CREATE TABLE IF NOT EXISTS public.edition_closure (
      program_edition_id  INTEGER PRIMARY KEY,
      survey_reinforced   BOOLEAN NOT NULL DEFAULT FALSE,
      grades_delivered    BOOLEAN NOT NULL DEFAULT FALSE,
      certificate_done    BOOLEAN NOT NULL DEFAULT FALSE,
      debt_validated      BOOLEAN NOT NULL DEFAULT FALSE,
      teacher_survey      BOOLEAN NOT NULL DEFAULT FALSE,
      final_report_sent   BOOLEAN NOT NULL DEFAULT FALSE,
      updated_by          INTEGER REFERENCES public.users(user_id),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)
    this._closureReady = true
  }

  async closuresList (editionIds) {
    await this.ensureClosureTable()
    if (!editionIds.length) return []
    const { rows } = await this.db.query(`
    SELECT * FROM public.edition_closure WHERE program_edition_id = ANY($1::int[])
  `, [editionIds])
    return rows
  }

  // `field` NO viene del request: el usecase lo valida contra CLOSURE_CHECKS
  // antes de llegar aca, porque se interpola en el SQL.
  async closureSave ({ edition_num_id, field, value }, uid) {
    await this.ensureClosureTable()
    const client = await this.db.connect()
    try {
      await client.query('BEGIN')
      const { rows: prevRows } = await client.query(
        'SELECT * FROM public.edition_closure WHERE program_edition_id = $1 FOR UPDATE',
        [edition_num_id]
      )
      const prev = prevRows[0] || null
      const { rows } = await client.query(`
      INSERT INTO public.edition_closure (program_edition_id, ${field}, updated_by)
      VALUES ($1, $2, $3)
      ON CONFLICT (program_edition_id)
      DO UPDATE SET ${field} = EXCLUDED.${field}, updated_by = EXCLUDED.updated_by, updated_at = NOW()
      RETURNING *
    `, [edition_num_id, value, uid ?? null])
      const curr = rows[0]

      await client.query(`
      INSERT INTO public.audit_logs
        (table_name, record_id, action, user_id, changed_fields, old_data, new_data, transaction_id)
      VALUES ('edition_closure', $1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, txid_current())
    `, [
        edition_num_id,
        prev ? 'UPDATE' : 'INSERT',
        uid ?? null,
        JSON.stringify({ [field]: { old: prev?.[field] ?? false, new: value } }),
        prev ? JSON.stringify(prev) : null,
        JSON.stringify(curr)
      ])
      await client.query('COMMIT')
      return curr
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  // Sesiones programadas del aula (program_versions.sessions), para calcular
  // promedios de test y participacion server-side.
  async editionSessionsGet (id) {
    const { rows } = await this.db.query(`
    SELECT pv.sessions
      FROM public.program_editions pe
      JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
     WHERE pe.edition_num_id = $1
  `, [id])
    return rows[0]?.sessions ?? null
  }

  // Notas guardadas de todos los alumnos de un aula.
  async classroomGradesGet (id) {
    await this.ensureGradesTable()
    const { rows } = await this.db.query(`
    SELECT enrollment_id, tests, participation, partial_criteria, final_criteria,
           test_score, participation_score, partial_score, final_deliv_score,
           final_grade, group_number, tracking_code, observation,
           odoo_cert_code, odoo_cert_at,
           updated_by, updated_at
      FROM public.classroom_student_grades
     WHERE program_edition_id = $1
     ORDER BY enrollment_id
  `, [id])
    return rows
  }

  // Datos para certificar el aula en Odoo: cabecera de la edicion (nombre del
  // grupo Odoo se arma con odoo_activation + start_date) + una fila por alumno
  // con su odoo_student_id (slide.group.student) y sus notas guardadas.
  async classroomOdooCertifyData (id) {
    await this.ensureGradesTable()
    const { rows } = await this.db.query(`
    SELECT prog.odoo_activation, pe.start_date,
           e.enrollment_id, e.odoo_student_id,
           per.first_name, per.last_name,
           g.partial_score, g.final_deliv_score, g.final_grade, g.participation,
           fin.fin_overdue
      FROM public.program_editions pe
      JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
      JOIN public.programs prog ON prog.program_id = pv.program_id
      LEFT JOIN public.enrollments e ON e.program_edition_id = pe.edition_num_id
      LEFT JOIN public.customers cust ON cust.customer_id = e.customer_id
      LEFT JOIN public.persons per ON per.person_id = cust.person_id
      LEFT JOIN public.classroom_student_grades g ON g.enrollment_id = e.enrollment_id
      -- deuda: cuotas vencidas impagas de la venta (padre si es hijo), misma
      -- regla que el marcador "Con deuda pendiente" de la lista de alumnos.
      LEFT JOIN LATERAL (
        SELECT (SELECT COUNT(*)::int
                  FROM public.payment_installments pi
                  JOIN public."catalog" cs ON cs.catalog_id = pi.cat_status
                 WHERE pi.enrollment_id = COALESCE(e.parent_enrollment_id, e.enrollment_id)
                   AND pi.installment_number > 0
                   AND pi.due_date < CURRENT_DATE
                   AND cs.alias NOT IN ('we_inst_paid', 'we_payment_status_paid')
               ) AS fin_overdue
      ) fin ON TRUE
     WHERE pe.edition_num_id = $1
  `, [id])
    return rows
  }

  // Backfill de odoo_student_id resueltos por nombre durante la certificación.
  // Solo completa vacíos, nunca pisa un id ya guardado.
  async backfillOdooStudentIds (items) {
    for (const it of (items || [])) {
      await this.db.query(`
      UPDATE public.enrollments SET odoo_student_id = $1
       WHERE enrollment_id = $2 AND odoo_student_id IS NULL
    `, [it.odoo_student_id, it.enrollment_id])
    }
  }

  // Marca en la fila de notas el certificado emitido en Odoo (código + fecha).
  async saveCertCodes (items) {
    for (const it of (items || [])) {
      await this.db.query(`
      UPDATE public.classroom_student_grades
         SET odoo_cert_code = $1, odoo_cert_at = NOW()
       WHERE enrollment_id = $2 AND odoo_cert_code IS DISTINCT FROM $1
    `, [it.cert_code, it.enrollment_id])
    }
  }

  // Bulk upsert transaccional de filas de notas. Los items llegan saneados y
  // con totales ya calculados por el usecase (la formula no vive aqui).
  async classroomGradesSaveBulk (eid, items, uid) {
    await this.ensureGradesTable()
    const client = await this.db.connect()
    try {
      await client.query('BEGIN')
      const saved = []
      for (const it of items) {
        const { rows } = await client.query(`
        INSERT INTO public.classroom_student_grades
          (program_edition_id, enrollment_id, tests, participation,
           partial_criteria, final_criteria, test_score, participation_score,
           partial_score, final_deliv_score, final_grade,
           group_number, tracking_code, observation, updated_by, updated_at)
        VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb,
                $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
        ON CONFLICT (enrollment_id) DO UPDATE
           SET tests = EXCLUDED.tests,
               participation = EXCLUDED.participation,
               partial_criteria = EXCLUDED.partial_criteria,
               final_criteria = EXCLUDED.final_criteria,
               test_score = EXCLUDED.test_score,
               participation_score = EXCLUDED.participation_score,
               partial_score = EXCLUDED.partial_score,
               final_deliv_score = EXCLUDED.final_deliv_score,
               final_grade = EXCLUDED.final_grade,
               group_number = EXCLUDED.group_number,
               tracking_code = EXCLUDED.tracking_code,
               observation = EXCLUDED.observation,
               updated_by = EXCLUDED.updated_by,
               updated_at = NOW()
        RETURNING enrollment_id, tests, participation, partial_criteria,
                  final_criteria, test_score, participation_score, partial_score,
                  final_deliv_score, final_grade, group_number, tracking_code,
                  observation, updated_by, updated_at
      `, [
          eid, it.enrollment_id,
          JSON.stringify(it.tests), JSON.stringify(it.participation),
          JSON.stringify(it.partial_criteria), JSON.stringify(it.final_criteria),
          it.test_score, it.participation_score, it.partial_score,
          it.final_deliv_score, it.final_grade,
          it.group_number, it.tracking_code, it.observation, uid
        ])
        saved.push(rows[0])
      }
      await client.query('COMMIT')
      return saved
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  // ===================================================================
  // Seguimiento B2B (Academica): asistencia MANUAL de los alumnos B2B en
  // aulas EN VIVO. Deliberadamente separada de la Lista de Notas: tabla
  // propia, nadie escribe en la otra. Lo unico que viaja de notas hacia
  // aca es final_grade, de solo lectura.
  // ===================================================================
  async ensureB2bAttendanceTable () {
    if (this._b2bAttendanceReady) return
    await this.db.query(`
    CREATE TABLE IF NOT EXISTS public.b2b_attendance (
      enrollment_id      INTEGER PRIMARY KEY REFERENCES public.enrollments(enrollment_id) ON DELETE CASCADE,
      program_edition_id INTEGER NOT NULL REFERENCES public.program_editions(edition_num_id) ON DELETE CASCADE,
      -- {"1":"P","2":"T","3":"F"} — solo las sesiones ya marcadas
      sessions           JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_by         INTEGER REFERENCES public.users(user_id),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_b2ba_edition
      ON public.b2b_attendance (program_edition_id);
    -- Motivo escrito por academica para las sesiones marcadas 'J', misma
    -- forma que sessions: {"2":"Viaje de trabajo"}. Columna aparte para que
    -- el valor de la asistencia siga siendo una sola letra.
    ALTER TABLE public.b2b_attendance
      ADD COLUMN IF NOT EXISTS notes JSONB NOT NULL DEFAULT '{}'::jsonb;
  `)
    this._b2bAttendanceReady = true
  }

  // Una fila por alumno B2B matriculado en un aula EN VIVO
  // (programs.cat_model_modality = we_modality_live).
  //
  // "Es B2B" usa LA MISMA regla que classroomStudentsList / el contador del
  // cronograma (isB2bSaleSql), mirando la venta (el padre si es hijo de
  // paquete): canal 'B2B' con cualquier asesor, o documento OS/OP con asesor de
  // convenios o sin asesor.
  //
  // Mismas exclusiones que la Lista de Notas: solo FICO-aprobados, sin los que
  // salieron del aula (retiro / CC / RP) y solo HOJAS (un padre de paquete no
  // asiste, asisten sus hijos).
  async b2bTrackingList () {
    await this.ensureB2bAttendanceTable()
    const { rows } = await this.db.query(`
    SELECT pe.edition_num_id,
           pe.specific_code,
           pe.start_date::date::text                    AS start_date,
           pe.end_date::date::text                      AS end_date,
           pe.cat_day_combination_id,
           pv.abbreviation,
           pv.version_code,
           pv.sessions                                  AS total_sessions,
           dayc.description                             AS day_label,
           hourc.description                            AS hour_label,
           INITCAP(CONCAT(ins.first_name, ' ', ins.last_name)) AS instructor,
           e.enrollment_id,
           per.document_number                          AS dni,
           TRIM(BOTH FROM concat_ws(' ', per.first_name, per.last_name, per.mother_last_name)) AS full_name,
           contact_email.value                          AS email,
           contact_phone.value                          AS phone,
           COALESCE(es.agent_origin, e.agent_origin)    AS agent_origin,
           -- Solo lectura desde la Lista de Notas. Este modulo NUNCA la escribe.
           g.final_grade,
           COALESCE(att.sessions, '{}'::jsonb)          AS attendance,
           COALESCE(att.notes, '{}'::jsonb)             AS attendance_notes,
           att.updated_at                               AS attendance_updated_at
      FROM public.enrollments e
      JOIN public.customers cu        ON cu.customer_id = e.customer_id
      JOIN public.persons per         ON per.person_id  = cu.person_id
      JOIN public."catalog" cf        ON cf.catalog_id  = e.cat_fico_status
                                     AND cf.alias = 'we_enrollment_status_checked'
      JOIN public.program_editions pe ON pe.edition_num_id = e.program_edition_id
      JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
      JOIN public.programs p          ON p.program_id = pv.program_id
      JOIN public."catalog" cm        ON cm.catalog_id = p.cat_model_modality
                                     AND cm.alias = 'we_modality_live'
 LEFT JOIN public."catalog" cts       ON cts.catalog_id = e.cat_type_status
 LEFT JOIN public.enrollments es      ON es.enrollment_id = COALESCE(e.parent_enrollment_id, e.enrollment_id)
 LEFT JOIN public."catalog" cts_sold  ON cts_sold.catalog_id = es.cat_type_status
 LEFT JOIN public.users usold         ON usold.user_id = COALESCE(es.seller_agent_id, e.seller_agent_id)
 LEFT JOIN public."catalog" dayc      ON dayc.catalog_id = pe.cat_day_combination_id
 LEFT JOIN public."catalog" hourc     ON hourc.catalog_id = pe.cat_hour_combination_id
 LEFT JOIN public.instructors i       ON i.instructor_id = pe.instructor_id
 LEFT JOIN public.persons ins         ON ins.person_id = i.person_id
 LEFT JOIN public.classroom_student_grades g ON g.enrollment_id = e.enrollment_id
 LEFT JOIN public.b2b_attendance att  ON att.enrollment_id = e.enrollment_id
 LEFT JOIN LATERAL (
        SELECT pc.value FROM public.person_contacts pc
          JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact
                                 AND c.alias = 'we_way_contact_email'
         WHERE pc.person_id = per.person_id AND pc.active = 'Y'
         ORDER BY pc.registration_date DESC LIMIT 1
      ) contact_email ON TRUE
 LEFT JOIN LATERAL (
        SELECT pc.value FROM public.person_contacts pc
          JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact
                                 AND c.alias = 'we_way_contact_phone'
         WHERE pc.person_id = per.person_id AND pc.active = 'Y'
         ORDER BY pc.registration_date DESC LIMIT 1
      ) contact_phone ON TRUE
     WHERE e.active = 'Y'
       AND pe.active = 'Y'
       AND (${isB2bSaleSql({
         doctype: 'COALESCE(e.cat_b2b_doctype, es.cat_b2b_doctype)',
         origin: 'COALESCE(es.agent_origin, e.agent_origin)',
         advisor: 'usold.alias'
       })})
       AND (cts.alias IS NULL OR cts.alias NOT IN (
              'we_enrollment_status_retired',
              'we_enrollment_status_course_changed',
              'we_enrollment_status_reprogrammed'))
       AND (cts_sold.alias IS NULL OR cts_sold.alias <> 'we_enrollment_status_reprogrammed')
       AND NOT EXISTS (SELECT 1 FROM public.enrollments c
                        WHERE c.parent_enrollment_id = e.enrollment_id)
     ORDER BY pe.start_date DESC, pe.edition_num_id, per.last_name, per.first_name
  `)
    return rows
  }

  // Marca/desmarca UNA celda de asistencia. status null borra la clave para
  // que la sesion vuelva a "sin marcar" (y no quede como falta implicita).
  // `note` solo llega con estado 'J' (el usecase lo anula en los demas), asi
  // que null tambien significa "borra el motivo viejo de esta sesion".
  async b2bAttendanceSave ({ enrollment_id, program_edition_id, session_number, status, note }, uid) {
    await this.ensureB2bAttendanceTable()
    const { rows } = await this.db.query(`
    INSERT INTO public.b2b_attendance (enrollment_id, program_edition_id, sessions, notes, updated_by, updated_at)
    VALUES ($1, $2,
            CASE WHEN $4::text IS NULL THEN '{}'::jsonb
                 ELSE jsonb_build_object($3::text, $4::text) END,
            CASE WHEN $6::text IS NULL THEN '{}'::jsonb
                 ELSE jsonb_build_object($3::text, $6::text) END,
            $5, NOW())
    ON CONFLICT (enrollment_id) DO UPDATE
       SET sessions = CASE WHEN $4::text IS NULL
                           THEN public.b2b_attendance.sessions - $3::text
                           ELSE public.b2b_attendance.sessions || jsonb_build_object($3::text, $4::text) END,
           notes    = CASE WHEN $6::text IS NULL
                           THEN public.b2b_attendance.notes - $3::text
                           ELSE public.b2b_attendance.notes || jsonb_build_object($3::text, $6::text) END,
           program_edition_id = EXCLUDED.program_edition_id,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()
    RETURNING enrollment_id, sessions, notes, updated_at
  `, [enrollment_id, program_edition_id, String(session_number), status, uid, note ?? null])
    return rows[0]
  }
}

export const editionRepository = new EditionRepository()
