CREATE OR REPLACE PROCEDURE public.sp_fico_payment_detail_get(IN p_enrollment_id integer, INOUT p_cur refcursor DEFAULT NULL::refcursor)
 LANGUAGE plpgsql
AS $procedure$
BEGIN
  IF p_cur IS NULL THEN
    p_cur := 'cur_sp_payment_detail';
  END IF;

  OPEN p_cur FOR
  SELECT
    e.enrollment_id,
    e.registration_date AS enrollment_date,
    CONCAT(p.first_name, ' ', p.last_name) AS student_name,
    p.document_number,
    pv.abbreviation AS program_name,
    -- Sin edicion NO significa membresia: los productos online y las ventas que
    -- todavia no tienen edicion asignada tambien vienen con program_edition_id
    -- null. Solo se rotula MEMBRESIA cuando el programa realmente lo es; el
    -- resto sale null y el detalle muestra '---'.
    COALESCE(pe.global_code, CASE WHEN prog.is_membership THEN 'MEMBRESIA' END) AS edition_code,
    e.total_amount,
    e.discount_amount,
    e.total_amount AS net_amount,
    curr.variable_2 AS currency_symbol,
    e.cat_currency AS cat_currency_id,
    (
      SELECT jsonb_agg(inst_row)
      FROM (
        SELECT
          pi.installment_id,
          pi.installment_number,
          pi.amount,
          pi.due_date,
          c_inst.description AS status_label,
          c_inst.alias AS status_alias
        FROM public.payment_installments pi
        LEFT JOIN public.catalog c_inst ON pi.cat_status = c_inst.catalog_id
        WHERE pi.enrollment_id = e.enrollment_id
        ORDER BY pi.installment_number ASC
      ) inst_row
    ) AS installments,
    (
      SELECT jsonb_agg(pay_row)
      FROM (
        SELECT
          py.payment_id,
          py.amount,
          py.payment_date,
          py.transaction_code,
          py.evidence_url,
          py.installment_id,
          py.cat_method_payment AS cat_payment_medium_id,
          py.settled_in_account_id AS bank_account_id,
          c_set.description AS settlement_status,
          c_set.alias AS settlement_alias,
          c_meth.description AS payment_method,
          ba.bank_name AS bank_name,
          ba.account_number AS bank_account_number,
          ba.currency AS bank_currency,
          ba.business_entity_catalog_id AS cat_business_entity_id,
          c_be.description AS business_entity
        FROM public.payments py
        LEFT JOIN public.catalog c_set ON py.cat_settlement_status = c_set.catalog_id
        LEFT JOIN public.catalog c_meth ON py.cat_method_payment = c_meth.catalog_id
        LEFT JOIN public.bank_accounts ba ON ba.account_id = py.settled_in_account_id
        LEFT JOIN public.catalog c_be ON ba.business_entity_catalog_id = c_be.catalog_id
        WHERE py.enrollment_id = e.enrollment_id AND py.active = 'Y'
        ORDER BY py.payment_date DESC
      ) pay_row
    ) AS payment_history
  FROM public.enrollments e
  JOIN public.customers cust ON e.customer_id = cust.customer_id
  JOIN public.persons p ON cust.person_id = p.person_id
  LEFT JOIN public.program_versions pv ON e.program_version_id = pv.program_version_id
  LEFT JOIN public.programs prog ON prog.program_id = pv.program_id
  LEFT JOIN public.program_editions pe ON e.program_edition_id = pe.edition_num_id
  LEFT JOIN public.catalog curr ON e.cat_currency = curr.catalog_id
  WHERE e.enrollment_id = p_enrollment_id;
END;
$procedure$
