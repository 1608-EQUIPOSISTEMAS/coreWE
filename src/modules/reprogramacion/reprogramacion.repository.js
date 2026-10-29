import { pool } from '../../shared/db/pool.js'

// Unico que habla con la BD. La bandeja se DERIVA de las ediciones A5 en vivo:
// no hay job de siembra ni tabla espejo que se desincronice. reprogram_cases
// guarda solo el workflow de los casos que alguien ya tomo.
export class ReprogramacionRepository {
  constructor (db = pool) {
    this.db = db
  }

  // Estados que sacan a un alumno del aula: ya no hay nada que reprogramarle.
  static get TERMINALES () {
    return `('we_enrollment_status_retired',
             'we_enrollment_status_course_changed',
             'we_enrollment_status_reprogrammed')`
  }

  // Elegibilidad de "alumno vivo", identica a la del cronograma: activo,
  // FICO-aprobado y sin estado retirado / cambiado / reprogramado.
  // La VENTA tambien tiene que estar viva: un CC retira solo los modulos que aun
  // no empiezan, asi que un paquete ya reubicado deja atras modulos vivos en la
  // edicion A5 que volvian a arrastrar a la bandeja una venta ya resuelta.
  static get VIVO () {
    return `
      e.active = 'Y'
      AND cf.alias = 'we_enrollment_status_checked'
      AND (cts.alias  IS NULL OR cts.alias  NOT IN ${ReprogramacionRepository.TERMINALES})
      AND (vts.alias  IS NULL OR vts.alias  NOT IN ${ReprogramacionRepository.TERMINALES})`
  }

  // Bandeja: UNA fila por CASO. Desde el 27/10/2026 el caso es el CURSO que se
  // cayo, no la venta: si compro un paquete y solo se cancelo un curso, se
  // reprograma ese curso y el paquete sigue igual. La fila es la venta solo
  // cuando lo que se cayo es la venta misma (curso suelto, o la edicion del
  // paquete entero), o cuando ya habia un caso abierto sobre la venta (flujo
  // anterior: no se le cambia de dueno a medio camino).
  async listAffected () {
    const { rows } = await this.db.query(`
    WITH iniciado AS (
      -- Paquetes con algun curso vivo ya empezado: no se mudan enteros (la RP
      -- del paquete completo lo rechaza), se reprograman sus cursos caidos.
      SELECT DISTINCT h.parent_enrollment_id AS venta_id
        FROM public.enrollments h
        JOIN public.program_editions hpe ON hpe.edition_num_id = h.program_edition_id
        LEFT JOIN public."catalog" hts ON hts.catalog_id = h.cat_type_status
       WHERE h.parent_enrollment_id IS NOT NULL AND h.active = 'Y'
         AND hpe.start_date <= CURRENT_DATE
         AND (hts.alias IS NULL OR hts.alias NOT IN ${ReprogramacionRepository.TERMINALES})
    ),
    con_caso AS (
      SELECT enrollment_id FROM public.reprogram_cases WHERE active = 'Y'
    ),
    caida AS (
      SELECT e.enrollment_id,
             e.parent_enrollment_id,
             CASE
               -- Caso abierto antes sobre la venta: se queda donde esta.
               WHEN e.parent_enrollment_id IN (SELECT enrollment_id FROM con_caso)
                AND e.enrollment_id NOT IN (SELECT enrollment_id FROM con_caso)
                 THEN e.parent_enrollment_id
               -- La venta misma: curso suelto, o paquete sin cursos empezados.
               -- Un paquete ya empezado no es caso (lo son sus cursos caidos).
               WHEN e.parent_enrollment_id IS NULL THEN
                 CASE WHEN e.enrollment_id IN (SELECT venta_id FROM iniciado)
                       AND e.enrollment_id NOT IN (SELECT enrollment_id FROM con_caso)
                      THEN NULL ELSE e.enrollment_id END
               -- Se cayo la edicion del paquete entero y no empezo: se muda entero.
               WHEN vseg.alias = 'we_segment_a5'
                AND e.parent_enrollment_id NOT IN (SELECT venta_id FROM iniciado)
                 THEN e.parent_enrollment_id
               ELSE e.enrollment_id
             END AS caso_id,
             pe.edition_num_id AS ed_a5,
             pe.specific_code  AS ed_a5_codigo,
             pe.start_date     AS ed_a5_inicio,
             p.program_name    AS ed_a5_programa
        FROM public.enrollments e
        JOIN public."catalog" cf  ON cf.catalog_id = e.cat_fico_status
        LEFT JOIN public."catalog" cts ON cts.catalog_id = e.cat_type_status
        LEFT JOIN public.enrollments venta ON venta.enrollment_id = e.parent_enrollment_id
        LEFT JOIN public."catalog" vts ON vts.catalog_id = venta.cat_type_status
        LEFT JOIN public.program_editions vpe ON vpe.edition_num_id = venta.program_edition_id
        LEFT JOIN public."catalog" vseg ON vseg.catalog_id = vpe.cat_segment
        JOIN public.program_editions pe ON pe.edition_num_id = e.program_edition_id
        JOIN public."catalog" cseg ON cseg.catalog_id = pe.cat_segment
                                  AND cseg.alias = 'we_segment_a5'
        JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
        JOIN public.programs p ON p.program_id = pv.program_id
       WHERE (${ReprogramacionRepository.VIVO})
          -- Una vez que alguien tomo el caso, la fila se queda aunque el alumno
          -- deje de estar "vivo": ejecutar el veredicto lo marca reprogramado,
          -- cambiado o retirado, y sin esto el resultado desaparecia de la
          -- bandeja apenas se aprobaba (el KPI de reubicados vivia en cero).
          OR EXISTS (
               SELECT 1 FROM public.reprogram_cases rc2
                WHERE rc2.active = 'Y'
                  AND rc2.enrollment_id IN (e.enrollment_id, e.parent_enrollment_id))
    )
    SELECT v.enrollment_id,
           (v.enrollment_id <> COALESCE(v.parent_enrollment_id, v.enrollment_id)) AS es_curso,
           COALESCE(v.parent_enrollment_id, v.enrollment_id) AS venta_id,
           per.person_id,
           per.document_number                    AS dni,
           per.first_name                         AS nombres,
           TRIM(concat_ws(' ', per.last_name, per.mother_last_name)) AS apellidos,
           tel.value                              AS celular,
           mail.value                             AS correo,
           -- "Compro": la venta (el paquete si es un curso suyo).
           COALESCE(vprog.program_name, prog.program_name) AS programa,
           COALESCE(ved.specific_code, ed.specific_code)   AS venta_edicion_codigo,
           COALESCE(ved.start_date, ed.start_date)         AS venta_edicion_inicio,
           -- El caso: el curso que se reprograma (o la venta misma).
           CASE WHEN v.parent_enrollment_id IS NOT NULL THEN prog.program_name END AS curso,
           v.program_version_id,
           ed.edition_num_id                      AS edicion_id,
           ed.specific_code                       AS edicion_codigo,
           ed.start_date                          AS edicion_inicio,
           COALESCE(vv.total_amount, v.total_amount)       AS total_amount,
           COALESCE(vv.discount_amount, v.discount_amount) AS discount_amount,
           -- Cuotas que el alumno todavia debe, con la MISMA regla que usa la RP
           -- para trasladarlas (enrollment.repository.getReprogramPendingInstallments):
           -- si las dos cuentas no coinciden, FICO firma a ciegas.
           (SELECT jsonb_build_object('cantidad', COUNT(*)::int,
                                      'monto', COALESCE(SUM(pi.amount), 0))
              FROM public.payment_installments pi
             WHERE pi.enrollment_id = COALESCE(v.parent_enrollment_id, v.enrollment_id)
               AND pi.installment_number > 0
               AND pi.cat_status NOT IN (4454, 2471, 4456)
               AND NOT EXISTS (SELECT 1 FROM public.payments p
                                WHERE p.installment_id = pi.installment_id AND p.active = 'Y')
           ) AS cuotas_pendientes,
           (SELECT jsonb_agg(DISTINCT jsonb_build_object(
                     'edition_id', c.ed_a5,
                     'codigo',     c.ed_a5_codigo,
                     'programa',   c.ed_a5_programa,
                     'inicio',     c.ed_a5_inicio,
                     'es_la_venta', c.enrollment_id = v.enrollment_id))
              FROM caida c WHERE c.caso_id = v.enrollment_id) AS caidas,
           rc.reprogram_case_id, rc.status, rc.dest_program_version_id,
           rc.dest_edition_id, rc.dest_kind,
           rc.proposed_source,
           rc.contacted_at, rc.contact_notes, rc.verdict_at, rc.verdict_notes,
           rc.new_enrollment_id, rc.pending_steps,
           dest_p.program_name                    AS destino_programa,
           dest_ed.specific_code                  AS destino_codigo,
           dest_ed.start_date                     AS destino_inicio
      FROM public.enrollments v
      JOIN public.customers cu ON cu.customer_id = v.customer_id
      JOIN public.persons per  ON per.person_id = cu.person_id
      JOIN public.program_versions pver ON pver.program_version_id = v.program_version_id
      JOIN public.programs prog ON prog.program_id = pver.program_id
      LEFT JOIN public.program_editions ed ON ed.edition_num_id = v.program_edition_id
      LEFT JOIN public.enrollments vv ON vv.enrollment_id = v.parent_enrollment_id
      LEFT JOIN public.program_versions vpver ON vpver.program_version_id = vv.program_version_id
      LEFT JOIN public.programs vprog ON vprog.program_id = vpver.program_id
      LEFT JOIN public.program_editions ved ON ved.edition_num_id = vv.program_edition_id
      LEFT JOIN public.reprogram_cases rc ON rc.enrollment_id = v.enrollment_id AND rc.active = 'Y'
      LEFT JOIN public.program_versions dest_pv ON dest_pv.program_version_id = rc.dest_program_version_id
      LEFT JOIN public.programs dest_p ON dest_p.program_id = dest_pv.program_id
      LEFT JOIN public.program_editions dest_ed ON dest_ed.edition_num_id = rc.dest_edition_id
      LEFT JOIN LATERAL (
        SELECT pc.value FROM public.person_contacts pc
          JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact
                                 AND c.alias = 'we_way_contact_phone'
         WHERE pc.person_id = per.person_id AND pc.active = 'Y'
         ORDER BY pc.person_contact_id DESC LIMIT 1
      ) tel ON TRUE
      LEFT JOIN LATERAL (
        SELECT pc.value FROM public.person_contacts pc
          JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact
                                 AND c.alias = 'we_way_contact_email'
         WHERE pc.person_id = per.person_id AND pc.active = 'Y'
         ORDER BY pc.person_contact_id DESC LIMIT 1
      ) mail ON TRUE
     WHERE v.enrollment_id IN (SELECT caso_id FROM caida WHERE caso_id IS NOT NULL)
     ORDER BY per.last_name, per.first_name`)
    return rows
  }

  async getCase (enrollmentId) {
    const { rows } = await this.db.query(
      "SELECT * FROM public.reprogram_cases WHERE enrollment_id = $1 AND active = 'Y'",
      [enrollmentId]
    )
    return rows[0] || null
  }

  // Datos de la venta que necesitan los casos de uso de FICO (RP / CC).
  async getVenta (enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT e.enrollment_id, e.parent_enrollment_id, e.program_version_id, e.program_edition_id,
             e.total_amount, e.discount_amount, e.cat_currency
        FROM public.enrollments e
       WHERE e.enrollment_id = $1 AND e.active = 'Y'`, [enrollmentId])
    return rows[0] || null
  }

  async upsertProposal ({ enrollmentId, destProgramVersionId, destEditionId, destKind, userId, origen }) {
    const { rows } = await this.db.query(`
      INSERT INTO public.reprogram_cases
             (enrollment_id, status, dest_program_version_id, dest_edition_id, dest_kind,
              proposed_by, proposed_at, proposed_source)
      VALUES ($1, 'propuesto', $2, $3, $4, $5, now(), $6)
      ON CONFLICT (enrollment_id) WHERE active = 'Y'
      DO UPDATE SET dest_program_version_id = EXCLUDED.dest_program_version_id,
                    dest_edition_id         = EXCLUDED.dest_edition_id,
                    dest_kind               = EXCLUDED.dest_kind,
                    proposed_by             = EXCLUDED.proposed_by,
                    proposed_at             = now(),
                    proposed_source         = EXCLUDED.proposed_source,
                    modification_date       = now()
      RETURNING *`, [enrollmentId, destProgramVersionId, destEditionId, destKind, userId, origen])
    return rows[0]
  }

  async markContacted ({ enrollmentId, notes, userId }) {
    const { rows } = await this.db.query(`
      UPDATE public.reprogram_cases
         SET status = 'contactado', contacted_by = $2, contacted_at = now(),
             contact_notes = $3, modification_date = now()
       WHERE enrollment_id = $1 AND active = 'Y'
      RETURNING *`, [enrollmentId, userId, notes || null])
    return rows[0] || null
  }

  async saveVerdict ({ enrollmentId, status, notes, userId, newEnrollmentId = null, pendingSteps = [] }) {
    const { rows } = await this.db.query(`
      UPDATE public.reprogram_cases
         SET status = $2, verdict_by = $3, verdict_at = now(), verdict_notes = $4,
             new_enrollment_id = COALESCE($5, new_enrollment_id),
             pending_steps = $6::jsonb, modification_date = now()
       WHERE enrollment_id = $1 AND active = 'Y'
      RETURNING *`,
    [enrollmentId, status, userId, notes || null, newEnrollmentId, JSON.stringify(pendingSteps)])
    return rows[0] || null
  }

  // Ediciones futuras de un programa, para el selector de destino de Academica.
  // Se excluyen las A5: mandar a un alumno varado a otra edicion cancelada seria
  // volver a empezar.
  async listDestinationEditions (programVersionId) {
    const { rows } = await this.db.query(`
      SELECT pe.edition_num_id, pe.specific_code, pe.global_code, pe.start_date
        FROM public.program_editions pe
        LEFT JOIN public."catalog" cseg ON cseg.catalog_id = pe.cat_segment
       WHERE pe.program_version_id = $1
         AND pe.active = 'Y'
         AND pe.start_date > CURRENT_DATE
         AND (cseg.alias IS NULL OR cseg.alias <> 'we_segment_a5')
       ORDER BY pe.start_date`, [programVersionId])
    return rows
  }
}

export const reprogramacionRepository = new ReprogramacionRepository()
