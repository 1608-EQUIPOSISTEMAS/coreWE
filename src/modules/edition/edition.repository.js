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

  // Contadores del cronograma por edicion. Son DOS metricas distintas que NO
  // suman entre si (ver hoja de referencia de negocio):
  //
  //  A) COMERCIAL (columnas VENTAS / SEGUI / B2B / MEMB / BECA): donde se REGISTRA
  //     la venta o el seguimiento. La venta de un paquete vive en el PADRE, no en
  //     el hijo. Por eso el PADRE (especializacion/diploma) SI muestra sus ventas
  //     en su fila (VENTAS/B2B/MEMB), aunque su AULA sea 0.
  //       - PADRE (tiene hijos) o VENTA DIRECTA (standalone): es la venta. Canal
  //         por el enrollment: MEMB (socio) > B2B (doctype o agent '%b2b%') >
  //         BECA (total 0) > VENTAS.
  //       - 1er CURSO de un paquete (hijo sin hermano que empiece antes, = orden
  //         de la rama en la modal Jerarquia): NO cuenta comercial; su venta esta
  //         arriba, en el padre.
  //       - 2do+ CURSO de un paquete, o destino de CAMBIO DE CURSO: SEGUI (o MEMB
  //         si la persona es socia: socio manda siempre).
  //       - E0 (padre con program_edition_id NULL: modulos inscritos sueltos):
  //         TODOS los modulos cuentan como SEG (la venta del diploma se vendio
  //         aparte, no aparece como venta aqui).
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
          -- destino de cambio de curso => seguimiento en su aula nueva
          WHEN EXISTS (SELECT 1 FROM public.course_changes cc
                        WHERE cc.enrollment_destination_id = e.enrollment_id)
            THEN CASE WHEN mem.is_member THEN 'MEMB' ELSE 'SEGUI' END
          -- HIJO de paquete:
          WHEN e.parent_enrollment_id IS NOT NULL THEN
            CASE
              -- E0: el padre quedo SIN edicion (clearParentEdition: modulos
              -- inscritos sueltos). La venta del diploma se conto aparte; aqui
              -- TODOS los modulos cuentan como SEG (socio manda igual).
              WHEN par.program_edition_id IS NULL
                THEN CASE WHEN mem.is_member THEN 'MEMB' ELSE 'SEGUI' END
              -- 1er curso (sin hermano que empiece antes): venta en el padre
              WHEN NOT EXISTS (
                     SELECT 1 FROM public.enrollments sib
                       JOIN public.program_editions pesib
                         ON pesib.edition_num_id = sib.program_edition_id
                      WHERE sib.parent_enrollment_id = e.parent_enrollment_id
                        AND sib.enrollment_id <> e.enrollment_id
                        AND (pesib.start_date, pesib.edition_num_id)
                          < (pe_e.start_date, pe_e.edition_num_id)
                   ) THEN NULL
              WHEN mem.is_member THEN 'MEMB'   -- socio manda siempre
              ELSE 'SEGUI'                     -- 2do+ curso
            END
          -- PADRE (tiene hijos) o VENTA DIRECTA (standalone): es la venta.
          WHEN mem.is_member THEN 'MEMB'
          WHEN e.cat_b2b_doctype IS NOT NULL OR e.agent_origin ILIKE '%b2b%' THEN 'B2B'
          WHEN COALESCE(e.total_amount, 0) = 0 THEN 'BECA'
          ELSE 'VENTAS'
        END AS comm_bucket,
        -- B) HOJA = asiste a un aula (hijos + standalone). El PADRE (tiene hijos y
        --    no tiene padre) NO es aula. Misma regla que classroomMetricsList.
        (e.parent_enrollment_id IS NOT NULL
          OR NOT EXISTS (SELECT 1 FROM public.enrollments ch
                          WHERE ch.parent_enrollment_id = e.enrollment_id)) AS is_leaf,
        -- beca de la hoja: la venta (propia o del padre) en total 0, sin B2B ni
        -- socio (mismo criterio is_beca que classroomStudentsList).
        (COALESCE(e.cat_b2b_doctype, par.cat_b2b_doctype) IS NULL
          AND COALESCE(par.agent_origin, e.agent_origin, '') NOT ILIKE '%b2b%'
          AND COALESCE(par.total_amount, e.total_amount, 0) = 0
          AND NOT mem.is_member) AS is_beca_leaf
        FROM public.enrollments e
        JOIN public."catalog" cf   ON cf.catalog_id = e.cat_fico_status
        LEFT JOIN public."catalog" cts ON cts.catalog_id = e.cat_type_status
        JOIN public.customers cust ON cust.customer_id = e.customer_id
        JOIN public.program_editions pe_e ON pe_e.edition_num_id = e.program_edition_id
        -- venta del padre (solo hijos): para resolver beca/canal del 1er curso.
        LEFT JOIN public.enrollments par ON par.enrollment_id = e.parent_enrollment_id
        LEFT JOIN public."catalog" parcts ON parcts.catalog_id = par.cat_type_status
        LEFT JOIN LATERAL (
          -- la persona tiene una membresia FICO-aprobada y vigente que REGALA
          -- cursos (WE BLACK/GOLD/PLAT). Se EXCLUYE 'MEMBRESIA PLUS': no da cursos
          -- de beneficio, asi que un socio PLUS que lleva un curso es VENTA real,
          -- no MEMB. Confirmado con negocio.
          SELECT EXISTS (
            SELECT 1
              FROM public.enrollments em
              JOIN public.customers cm         ON cm.customer_id = em.customer_id
              JOIN public.program_versions pvm ON pvm.program_version_id = em.program_version_id
              JOIN public.programs pm          ON pm.program_id = pvm.program_id AND pm.is_membership = true
                                                AND UPPER(TRIM(pm.program_name)) <> 'MEMBRESIA PLUS'
              JOIN public."catalog" cfm        ON cfm.catalog_id = em.cat_fico_status AND cfm.alias = 'we_enrollment_status_checked'
             WHERE cm.person_id = cust.person_id AND em.active = 'Y'
          ) AS is_member
        ) mem ON TRUE
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
         -- HIJO de un padre RP: el diploma se reprogramo a otra edicion, asi que
         -- este modulo tampoco asiste aqui (se fue con el padre). Lo excluye del
         -- AULA tambien, no solo del comercial => aula y comercial cuadran.
         AND (parcts.alias IS NULL OR parcts.alias <> 'we_enrollment_status_reprogrammed')
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

  // Conteo de CONSULTAS (leads) por edicion para el cronograma. Cuenta los leads
  // activos de la edicion EXCLUYENDO los estados Desestimado, Cerrado e
  // Indiferente (los demas si cuentan: atendido, interesado, pago, etc.).
  // Confirmado con negocio.
  async classroomLeadsCountList (ids) {
    const { rows } = await this.db.query(`
    SELECT l.program_edition_id AS edition_num_id, COUNT(*)::int AS cnt_consultas
      FROM public.leads l
 LEFT JOIN public."catalog" cs ON cs.catalog_id = l.cat_status_lead
     WHERE l.program_edition_id = ANY($1::int[])
       AND l.active = 'Y'
       AND (cs.alias IS NULL OR cs.alias NOT IN (
              'we_lead_status_desestimado',
              'we_lead_status_closed',
              'we_lead_status_indiferente'
            ))
     GROUP BY l.program_edition_id
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
           -- BECA: la venta (enrollment vendido) va en total 0 y NO es B2B NI socio.
           -- B2B gana (mismo criterio que el badge del front: doctype o agent_origin
           -- "B2B") y la membresia gana (si la persona es socia, es MEMB, no beca).
           -- COALESCE(agent_origin,'') evita que NULL NOT ILIKE tumbe becas sin agente.
           (COALESCE(e.cat_b2b_doctype, e_sold.cat_b2b_doctype) IS NULL
            AND COALESCE(e_sold.agent_origin, e.agent_origin, '') NOT ILIKE '%b2b%'
            AND COALESCE(e_sold.total_amount, e.total_amount, 0) = 0
            AND mem.tier_name IS NULL) AS is_beca,
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
     WHERE (
            e.program_edition_id = $1
            -- ...o fue REPROGRAMADA fuera de esta aula: setProgramEdition movio la
            -- fila a otra edicion, asi que ya no matchea por program_edition_id;
            -- el vinculo con el aula origen quedo en el audit log (old_edition_id).
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
