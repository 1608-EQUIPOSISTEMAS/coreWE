import { pool } from '../../shared/db/pool.js'
import { callProcedureReturningRows } from '../../shared/db/sp.js'
import { buildOdooEmailBase } from '../../utils/fico-odoo.helper.js'

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

  async a5PendingEnrollments (editionId) {
    return this.sp(
      this.db,
      'public.sp_edition_a5_pending_enrollments',
      [editionId],
      { statementTimeoutMs: 20000 }
    )
  }

  async a5MigrationExecute (payload, user_id) {
    return this.sp(
      this.db,
      'public.sp_edition_a5_migration_execute',
      [JSON.stringify(payload || {}), user_id],
      { statementTimeoutMs: 60000 }
    )
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

  // Conteo de alumnos por edicion (aula): inscripciones FICO-aprobadas, activas
  // y solo hojas del arbol (hijos de programa o cursos standalone sin hijos).
  async classroomMetricsList (ids) {
    const { rows } = await this.db.query(`
    SELECT e.program_edition_id AS edition_num_id,
           COUNT(*)::int        AS students
      FROM public.enrollments e
      JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
     WHERE e.program_edition_id = ANY($1::int[])
       AND e.active = 'Y'
       AND cf.alias = 'we_enrollment_status_checked'
       AND (
            e.parent_enrollment_id IS NOT NULL
         OR NOT EXISTS (
              SELECT 1 FROM public.enrollments c
               WHERE c.parent_enrollment_id = e.enrollment_id
            )
       )
     GROUP BY e.program_edition_id
  `, [ids])
    return rows
  }

  // Conteo por CANAL de adquisicion por edicion (aula), para el contador del
  // cronograma. OJO: `parent_enrollment_id` tiene DOS significados y se separan
  // con la tabla course_changes (origin/destination):
  //   * hijo por CAMBIO DE CURSO -> esta en course_changes.enrollment_destination_id.
  //   * hijo de PAQUETE/diploma  -> tiene parent_enrollment_id pero NO esta en
  //     course_changes (su venta vive en el padre, el diploma).
  // Elegibilidad para el contador (una venta se cuenta UNA vez, en su aula):
  //   - se EXCLUYE la inscripcion REEMPLAZADA por un cambio de curso (es origin en
  //     course_changes): "en la que hizo el primer pago no cuenta".
  //   - HIJO de PAQUETE/diploma: el padre NO es curso, solo es la venta. El PRIMER
  //     curso del paquete (hijo con la edicion de inicio mas temprana entre
  //     hermanos) se EXCLUYE: cuenta 0 porque la venta del padre esta "arriba".
  //     Del SEGUNDO curso en adelante, el hijo cuenta como SEGUI (seguimiento) en
  //     su aula. Asi el alumno suma 1 venta (padre) + 1 SEGUI por curso posterior.
  //   - se INCLUYE: venta directa (sin padre), el PADRE/diploma, el hijo de paquete
  //     de curso 2+ (SEGUI) y el hijo por cambio de curso (SEGUI en su aula nueva).
  // Cascada de PRIORIDAD (primer match gana; cada inscrito en UN solo canal, asi
  // AULA = VENTAS+SEGUI+MEMB+B2B no descuadra):
  //   1. SEGUI  -> destino de cambio de curso, o hijo de paquete de curso 2+
  //               (salvo que la persona sea socia: ahi gana MEMB, ver abajo).
  //   2. B2B    -> cat_b2b_doctype. ANTES de BECA: el corporativo suele ir en 0.
  //   3. BECA   -> total_amount = 0 (incluye 100% dscto). APARTE: no suma a AULA.
  //                Misma regla que integration.repository (total=0 => BECA).
  //   4. MEMB   -> la persona tiene una membresia FICO-aprobada y vigente. Gana
  //               sobre el SEGUI de paquete: un socio SIEMPRE cuenta como MEMB
  //               aunque la inscripcion venga de un padre/diploma.
  //   5. VENTAS -> el resto (venta directa o diploma padre).
  // cnt_aula = todos menos BECA. cnt_total incluye becas (AULA + BECA = total).
  // ponytail: los EXISTS (membresia, course_changes) corren por inscrito; con
  // ~100 ediciones/mes es holgado. Si crece, materializar por persona/enrollment.
  async classroomChannelMetricsList (ids) {
    const { rows } = await this.db.query(`
    WITH roster AS (
      SELECT
        e.program_edition_id AS edition_num_id,
        CASE
          WHEN EXISTS (SELECT 1 FROM public.course_changes cc
                        WHERE cc.enrollment_destination_id = e.enrollment_id) THEN 'SEGUI'
          -- la membresia manda: si la persona es socia, va a MEMB aunque la
          -- inscripcion venga de un padre/paquete (nunca SEGUI en ese caso).
          WHEN e.parent_enrollment_id IS NOT NULL AND mem.is_member THEN 'MEMB'
          -- hijo de paquete que llego al roster = curso 2+ (el 1er curso se filtra
          -- abajo); cuenta como seguimiento en su aula.
          WHEN e.parent_enrollment_id IS NOT NULL THEN 'SEGUI'
          WHEN e.cat_b2b_doctype IS NOT NULL THEN 'B2B'
          WHEN COALESCE(e.total_amount, 0) = 0 THEN 'BECA'
          WHEN mem.is_member THEN 'MEMB'
          ELSE 'VENTAS'
        END AS bucket
        FROM public.enrollments e
        JOIN public."catalog" cf   ON cf.catalog_id = e.cat_fico_status
        JOIN public.customers cust ON cust.customer_id = e.customer_id
        JOIN public.program_editions pe_e ON pe_e.edition_num_id = e.program_edition_id
        LEFT JOIN LATERAL (
          -- la persona tiene una membresia FICO-aprobada y vigente (propiedad de
          -- la persona, no del enrollment; por eso se reusa en dos ramas).
          SELECT EXISTS (
            SELECT 1
              FROM public.enrollments em
              JOIN public.customers cm         ON cm.customer_id = em.customer_id
              JOIN public.program_versions pvm ON pvm.program_version_id = em.program_version_id
              JOIN public.programs pm          ON pm.program_id = pvm.program_id AND pm.is_membership = true
              JOIN public."catalog" cfm        ON cfm.catalog_id = em.cat_fico_status AND cfm.alias = 'we_enrollment_status_checked'
             WHERE cm.person_id = cust.person_id AND em.active = 'Y'
          ) AS is_member
        ) mem ON TRUE
       WHERE e.program_edition_id = ANY($1::int[])
         AND e.active = 'Y'
         AND cf.alias = 'we_enrollment_status_checked'
         -- no fue reemplazada por un cambio de curso (la origen no cuenta)
         AND NOT EXISTS (SELECT 1 FROM public.course_changes cc
                          WHERE cc.enrollment_origin_id = e.enrollment_id)
         AND (
              e.parent_enrollment_id IS NULL
           OR EXISTS (SELECT 1 FROM public.course_changes cc
                       WHERE cc.enrollment_destination_id = e.enrollment_id)
           -- hijo de paquete: incluir solo cursos 2+ (existe un hermano que
           -- empieza antes). El 1er curso se omite: su venta vive en el padre.
           OR EXISTS (SELECT 1 FROM public.enrollments sib
                        JOIN public.program_editions pesib
                          ON pesib.edition_num_id = sib.program_edition_id
                       WHERE sib.parent_enrollment_id = e.parent_enrollment_id
                         AND sib.enrollment_id <> e.enrollment_id
                         AND (pesib.start_date, pesib.edition_num_id)
                           < (pe_e.start_date, pe_e.edition_num_id))
         )
    )
    SELECT
      edition_num_id,
      COUNT(*) FILTER (WHERE bucket = 'VENTAS')::int AS cnt_ventas,
      COUNT(*) FILTER (WHERE bucket = 'SEGUI')::int  AS cnt_segui,
      COUNT(*) FILTER (WHERE bucket = 'MEMB')::int   AS cnt_memb,
      COUNT(*) FILTER (WHERE bucket = 'BECA')::int   AS cnt_becas,
      COUNT(*) FILTER (WHERE bucket = 'B2B')::int    AS cnt_b2b,
      COUNT(*) FILTER (WHERE bucket <> 'BECA')::int  AS cnt_aula,
      COUNT(*)::int                                  AS cnt_total
      FROM roster
     GROUP BY edition_num_id
  `, [ids])
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
           -- B2B: el doctype vive en el enrollment vendido (padre si es hijo
           -- de paquete). agent_origin identifica el convenio/agente (JP39...).
           (COALESCE(e.cat_b2b_doctype, e_sold.cat_b2b_doctype) IS NOT NULL) AS is_b2b,
           COALESCE(e_sold.agent_origin, e.agent_origin) AS agent_origin,
           -- Codigo del programa padre al que pertenece el alumno (solo hijos).
           CASE WHEN e.parent_enrollment_id IS NOT NULL
                THEN pv_sold.version_code END            AS parent_code,
           odoo_src.odoo_email                          AS odoo_email_stored,
           odoo_src.odoo_user_id                        AS odoo_user_id,
           COALESCE(prog_sold.is_membership, false)     AS is_member,
           -- Membresia del alumno (persona) en ventas FICO: tier vigente y flag.
           mem.tier_name                                AS membership_tier_name,
           (mem.tier_name IS NOT NULL)                  AS membership_active,
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
       -- Los que salieron del aula (retiro / cambio de curso) ya no van en la
       -- lista activa; quedan registrados en el Historial (classroomStudentsHistory).
       AND (cts.alias IS NULL OR cts.alias NOT IN (
              'we_enrollment_status_retired',
              'we_enrollment_status_course_changed'
            ))
       AND (
            e.parent_enrollment_id IS NOT NULL
         OR NOT EXISTS (
              SELECT 1 FROM public.enrollments c
               WHERE c.parent_enrollment_id = e.enrollment_id
            )
       )
     ORDER BY per.last_name, per.first_name
  `, [id])
    // platform_user: misma resolucion que el panel FICO (getEnrollmentFlags):
    // odoo_email guardado > sintetizado apellido.nombre@dominio si existe
    // cuenta Odoo (odoo_user_id) > correo de contacto registrado.
    return rows.map((r) => {
      const { odoo_email_stored, odoo_user_id, ...rest } = r
      let platformUser = (odoo_email_stored || '').trim() || null
      if (!platformUser && odoo_user_id) {
        const { base, domain } = buildOdooEmailBase(r.first_name, r.last_name)
        platformUser = `${base}${domain}`
      }
      return { ...rest, platform_user: platformUser || r.email || null }
    })
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
     WHERE e.program_edition_id = $1
       AND (
            e.active = 'N'
         OR cts.alias IN (
              'we_enrollment_status_retired',
              'we_enrollment_status_course_changed'
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
  `)
    this._gradesTableReady = true
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
           updated_by, updated_at
      FROM public.classroom_student_grades
     WHERE program_edition_id = $1
     ORDER BY enrollment_id
  `, [id])
    return rows
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
}

export const editionRepository = new EditionRepository()
