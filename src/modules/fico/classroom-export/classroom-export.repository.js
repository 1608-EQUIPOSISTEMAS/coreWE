import { pool } from '../../../shared/db/pool.js'

// Persistencia de la exportacion del aula virtual. Solo lectura: las queries se
// movieron verbatim desde el service legacy (getClassroomExportOptions /
// exportClassroomCsv). No contiene reglas de negocio ni serializacion.
export class ClassroomExportRepository {
  constructor (db = pool) {
    this.db = db
  }

  // Opciones de exportacion: inscripciones aprobadas, no membresia, con edicion.
  // Excluye padres con hijos (se exportan los hijos o los standalone). Agrupado
  // por version de programa y edicion con conteo de alumnos.
  async listOptions () {
    const { rows } = await this.db.query(`
      WITH approved AS (
        SELECT e.enrollment_id, e.program_version_id, e.program_edition_id
          FROM public.enrollments e
          JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
          LEFT JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
          LEFT JOIN public.programs prog ON prog.program_id = pv.program_id
         WHERE cf.alias = 'we_enrollment_status_checked'
           AND e.active = 'Y'
           AND e.program_edition_id IS NOT NULL
           AND COALESCE(prog.is_membership, false) = false
           AND (
                e.parent_enrollment_id IS NOT NULL
             OR NOT EXISTS (SELECT 1 FROM public.enrollments c WHERE c.parent_enrollment_id = e.enrollment_id)
           )
      )
      SELECT
        pv.program_version_id,
        pv.version_code,
        pv.abbreviation,
        a.program_edition_id   AS edition_num_id,
        pe.start_date,
        COUNT(*)::int          AS students_count
        FROM approved a
        JOIN public.program_versions pv ON pv.program_version_id = a.program_version_id
        LEFT JOIN public.program_editions pe ON pe.edition_num_id = a.program_edition_id
       GROUP BY pv.program_version_id, pv.version_code, pv.abbreviation,
                a.program_edition_id, pe.start_date
       ORDER BY pv.version_code, pe.start_date NULLS LAST
    `)
    return rows
  }

  // Alumnos de una edicion para el CSV. El estado financiero se evalua sobre el
  // enrollment vendido (padre si es hijo, propio si es standalone) via LATERAL,
  // espejando la logica de syncFicoSalesToSheet.
  async listStudentsForCsv ({ programVersionId, editionNumId }) {
    const { rows } = await this.db.query(`
      WITH approved AS (
        SELECT e.enrollment_id
          FROM public.enrollments e
          JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
         WHERE cf.alias = 'we_enrollment_status_checked'
           AND e.active = 'Y'
           AND e.program_version_id = $1
           AND e.program_edition_id = $2
           AND (
                e.parent_enrollment_id IS NOT NULL
             OR NOT EXISTS (SELECT 1 FROM public.enrollments c WHERE c.parent_enrollment_id = e.enrollment_id)
           )
      )
      SELECT
        TRIM(BOTH FROM concat_ws(' ', per.first_name, per.last_name, per.mother_last_name)) AS nombres_apellidos,
        COALESCE(pv_parent.version_code, '')                       AS cat_prog,
        CASE c_mod.alias
          WHEN 'we_insc_modality_flexible' THEN 'FLEX'
          ELSE 'REGULAR'
        END                                                        AS modalidad,
        COALESCE(
          l.origin_phone,
          (SELECT pc.value FROM public.person_contacts pc
            JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact AND c.alias = 'we_way_contact_phone'
           WHERE pc.person_id = per.person_id AND pc.active = 'Y'
           ORDER BY pc.registration_date DESC LIMIT 1)
        )                                                          AS celular,
        COALESCE(
          l.origin_email,
          (SELECT pc.value FROM public.person_contacts pc
            JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact AND c.alias = 'we_way_contact_email'
           WHERE pc.person_id = per.person_id AND pc.active = 'Y'
           ORDER BY pc.registration_date DESC LIMIT 1)
        )                                                          AS correo,
        CASE c_prof.alias
          WHEN 'we_profile_student' THEN 'E'
          ELSE 'P'
        END                                                        AS ocup,
        COALESCE(e.odoo_email, '')                                 AS correo_odoo,
        CASE
          WHEN COALESCE(fin.fin_paid, 0) >= COALESCE(fin.fin_total, 0) THEN 'Saldado'
          WHEN COALESCE(fin.fin_overdue, 0) > 0 THEN 'Deuda ' || fin.fin_overdue::text
          ELSE 'Al dia'
        END                                                        AS estado,
        CASE
          WHEN NULLIF(TRIM(ag.resolved_alias), '') IS NULL AND e_sold.agent_origin IS NOT NULL THEN e_sold.agent_origin
          WHEN NULLIF(TRIM(ag.resolved_alias), '') IS NULL THEN NULL
          WHEN e_sold.agent_origin IS NOT NULL THEN e_sold.agent_origin || ' - ' || ag.resolved_alias
          ELSE ag.resolved_alias
        END                                                        AS asesor
        FROM public.enrollments e
        JOIN approved a ON a.enrollment_id = e.enrollment_id
        JOIN public.customers cust ON cust.customer_id = e.customer_id
        JOIN public.persons per   ON per.person_id   = cust.person_id
        LEFT JOIN public.leads l ON l.enrollment_id = e.enrollment_id
        LEFT JOIN public."catalog" c_prof ON c_prof.catalog_id = e.cat_profile_id
        LEFT JOIN public."catalog" c_mod  ON c_mod.catalog_id  = e.cat_inscription_modality
        LEFT JOIN public.enrollments e_parent ON e_parent.enrollment_id = e.parent_enrollment_id
        LEFT JOIN public.program_versions pv_parent ON pv_parent.program_version_id = e_parent.program_version_id
        LEFT JOIN LATERAL (
          -- Evalua el estado financiero sobre el enrollment "vendido" (padre si es
          -- hijo de un diplomado/ESP, propio si es curso standalone). Espeja la
          -- logica de syncFicoSalesToSheet ('0. Ventas Sistemas'): suma de cuotas
          -- pagadas y conteo de cuotas vencidas no pagadas.
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
        -- Enrollment "vendido" (padre si es hijo de paquete, propio si es standalone)
        -- y su fila en la vista de reporte, para resolver el asesor de la venta real.
        LEFT JOIN public.enrollments e_sold ON e_sold.enrollment_id = COALESCE(e.parent_enrollment_id, e.enrollment_id)
        LEFT JOIN public.mv_enrollment_report_system v_sold ON v_sold."ID"::INT = e_sold.enrollment_id
        LEFT JOIN LATERAL (
          -- Misma cascada de asesor que sp_fico_enrollment_list: alias del usuario
          -- que solicito/creo el primer token de pago, con fallback al ASESOR de la
          -- vista. Garantiza que el export y la lista de inscripciones coincidan.
          SELECT COALESCE(
            (SELECT u.alias
               FROM public.payment_tokens pt
               LEFT JOIN public.users u ON u.user_id = COALESCE(pt.requested_by, pt.created_by)
              WHERE pt.enrollment_id = e_sold.enrollment_id
              ORDER BY pt.token_id ASC
              LIMIT 1),
            v_sold."ASESOR"::TEXT
          ) AS resolved_alias
        ) ag ON TRUE
       ORDER BY per.last_name, per.first_name
    `, [programVersionId, editionNumId])
    return rows
  }
}

export const classroomExportRepository = new ClassroomExportRepository()
