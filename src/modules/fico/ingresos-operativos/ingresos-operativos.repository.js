import { pool } from '../../../shared/db/pool.js'

// Unico que habla con la BD. SQL plano de solo lectura, como el reporte de
// ingresos B2C de marketing (ingresosB2C): mismo filtro de B2B, asi el
// consultor y el "Reporte Completo" de Gerencia cuadran.
//
// Una fila por pago activo del rango [$1, $2). Trae los ids crudos que
// necesita la entidad para deducir tipo de pago y linea de negocio.
const PAGOS_SQL = `
  SELECT
    p.payment_id,
    p.enrollment_id,
    to_char(p.payment_date, 'YYYY-MM-DD') AS fecha_pago,
    p.amount                AS monto,
    p.transaction_code      AS n_oper,
    p.cat_payment_type      AS payment_type_id,
    e.cat_currency          AS currency_id,
    e.total_amount          AS enrollment_total,
    plan.alias              AS payment_plan,
    pi.installment_number,
    ins.min_number,
    ins.total_installments,
    pr.cat_business_line_id AS business_line_id,
    pr.cat_type_program     AS type_program_id,
    pr.cat_model_modality   AS modality_id,
    tp.description          AS tipo_programa,
    cg.description          AS linea_producto,
    pr.program_name         AS curso,
    pe.specific_code        AS edicion,
    pv.version_code,
    COALESCE(
      NULLIF(trim(concat_ws(' ', ps.last_name, ps.mother_last_name, ps.first_name)), ''),
      co.razon_social
    )                       AS alumno,
    ph.value                AS celular,
    mp.description          AS medio_pago,
    emp.description         AS entidad_empresa,
    ba.bank_name            AS entidad_financiera,
    st.description          AS estado_liquidacion
  FROM payments p
  JOIN enrollments e        ON e.enrollment_id = p.enrollment_id AND e.active = 'Y'
  JOIN program_versions pv  ON pv.program_version_id = e.program_version_id
  JOIN programs pr          ON pr.program_id = pv.program_id
  LEFT JOIN program_editions pe     ON pe.edition_num_id = e.program_edition_id
  LEFT JOIN payment_installments pi ON pi.installment_id = p.installment_id
  LEFT JOIN LATERAL (
    SELECT min(x.installment_number) AS min_number, count(*)::int AS total_installments
      FROM payment_installments x
     WHERE x.enrollment_id = e.enrollment_id
  ) ins ON true
  LEFT JOIN customers cu ON cu.customer_id = e.customer_id
  LEFT JOIN persons ps   ON ps.person_id = cu.person_id
  LEFT JOIN companies co ON co.company_id = cu.company_id
  -- Celular: 2319 Telefono y, si no hay, 2320 WhatsApp; el principal primero.
  LEFT JOIN LATERAL (
    SELECT c.value
      FROM person_contacts c
     WHERE c.person_id = cu.person_id AND c.active = 'Y' AND c.cat_way_contact IN (2319, 2320)
     ORDER BY c.cat_way_contact, c.is_main DESC NULLS LAST, c.person_contact_id DESC
     LIMIT 1
  ) ph ON true
  LEFT JOIN bank_accounts ba ON ba.account_id = p.settled_in_account_id
  LEFT JOIN catalog plan ON plan.catalog_id = e.cat_payment_plan
  LEFT JOIN catalog emp ON emp.catalog_id = ba.business_entity_catalog_id
  LEFT JOIN catalog tp  ON tp.catalog_id  = pr.cat_type_program
  LEFT JOIN catalog cg  ON cg.catalog_id  = pr.cat_category
  LEFT JOIN catalog mp  ON mp.catalog_id  = p.cat_method_payment
  LEFT JOIN catalog st  ON st.catalog_id  = p.cat_settlement_status
  WHERE p.active = 'Y'
    AND p.payment_date >= $1::date
    AND p.payment_date <  $2::date
    AND e.cat_b2b_doctype IS NULL
    AND COALESCE(e.agent_origin, '') NOT ILIKE '%b2b%'
  ORDER BY p.payment_date, p.payment_id`

export async function listPagos (inicio, fin) {
  const { rows } = await pool.query(PAGOS_SQL, [inicio, fin])
  return rows
}

// Pagos fuera de venta del modulo FICO > Pagos Adicionales (migrados del sheet
// de adicionales el 26/10/2026). Suman a "Pagos extras" junto con los
// certificados, reasignaciones y diferencias por CC de la inscripcion: los que
// ya estaban en payments no se migraron, asi que no se duplican.
const ADICIONALES_SQL = `
  SELECT
    a.additional_payment_id,
    to_char(a.payment_date, 'YYYY-MM-DD') AS fecha_pago,
    a.amount            AS monto,
    a.currency,
    a.business_line,
    a.program,
    a.subject,
    a.full_name,
    a.phone,
    a.product_line,
    a.transaction_code,
    a.status,
    med.description     AS medio_pago,
    emp.description     AS entidad_empresa,
    ba.bank_name        AS entidad_financiera
  FROM public.fico_additional_payments a
  LEFT JOIN public.catalog med      ON med.catalog_id = a.cat_payment_medium
  LEFT JOIN public.catalog emp      ON emp.catalog_id = a.cat_business_entity
  LEFT JOIN public.bank_accounts ba ON ba.account_id = a.bank_account_id
  WHERE a.active = 'Y'
    AND a.payment_date >= $1::date
    AND a.payment_date <  $2::date
  ORDER BY a.payment_date, a.additional_payment_id`

export async function listAdicionales (inicio, fin) {
  const { rows } = await pool.query(ADICIONALES_SQL, [inicio, fin])
  return rows
}
