// Sondeo del enrollment 18534 (isabel.raez.c@gmail.com) para la hoja "7. Convenios":
// de donde salen EMPRESA (col B), TIPO PROGRAM (col R) y UNIDAD (col S).
import { q, pool } from './db.mjs'

const { rows } = await q(`
  SELECT e.enrollment_id, e.parent_enrollment_id, e.agent_origin, e.active,
         e.b2b_contract_id, e.program_version_id,
         pv.abbreviation, prog.program_id, prog.program_name AS programa,
         prog.cat_type_program, c_type.description AS tipo_program, c_type.alias AS tipo_alias,
         prog.cat_model_modality, c_mod.description AS unidad, c_mod.alias AS unidad_alias,
         l.lead_id, l.company_id, l.company_name, comp_lead.razon_social AS emp_lead,
         ctr.company_id AS ctr_company, comp_ctr.razon_social AS emp_ctr,
         cf.alias AS fico_status
    FROM public.enrollments e
    JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
    LEFT JOIN public.leads l             ON l.enrollment_id = e.enrollment_id
    LEFT JOIN public.companies comp_lead ON comp_lead.company_id = l.company_id
    LEFT JOIN public.b2b_contracts ctr   ON ctr.b2b_contract_id = e.b2b_contract_id
    LEFT JOIN public.companies comp_ctr  ON comp_ctr.company_id = ctr.company_id
    LEFT JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN public.programs prog       ON prog.program_id = pv.program_id
    LEFT JOIN public."catalog" c_type    ON c_type.catalog_id = prog.cat_type_program
    LEFT JOIN public."catalog" c_mod     ON c_mod.catalog_id = prog.cat_model_modality
   WHERE e.enrollment_id = 18534`)
console.log('enrollment:', rows)

// Cuantas ventas mas cuelgan del mismo programa (por si tocar el programa arrastra a otros).
if (rows[0]?.program_id) {
  const { rows: hermanos } = await q(`
    SELECT COUNT(*)::int AS ventas
      FROM public.enrollments e
      JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
     WHERE pv.program_id = $1 AND e.active = 'Y'`, [rows[0].program_id])
  console.log('ventas del mismo programa:', hermanos)
}

// Empresas que se parecen a "Estrategia B2B".
const { rows: emps } = await q(
  `SELECT company_id, razon_social FROM public.companies WHERE razon_social ILIKE '%estrategia%'`)
console.log('empresas Estrategia:', emps)

// Opciones de catalogo para EVENTO / Evento.
const { rows: cats } = await q(`
  SELECT catalog_id, alias, description, cat_type
    FROM public."catalog"
   WHERE description ILIKE '%evento%' AND active = 'Y'
   ORDER BY cat_type, catalog_id`)
console.log('catalogo evento:', cats)

await pool.end()
