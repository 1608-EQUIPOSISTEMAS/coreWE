import { pool } from '../../config/db.js'
import { getCatalogIdByAlias } from '../../utils/catalog-helper.js'
import { ALIAS } from '../../utils/catalog-aliases.js'

// Ingresos B2C del mes: pagos activos de enrollments no-B2B, agrupados por
// grupo (En Vivo / Online / Membresías), rubro y semana del mes.
// ponytail: suma montos sin convertir moneda (USD es minoritario); si pesa,
// convertir con tipo de cambio por fecha.
export async function ingresosB2C (monthStart) {
  const onlineId = await getCatalogIdByAlias(ALIAS.MODALITY_ONLINE)
  const { rows } = await pool.query(`
    SELECT
      CASE
        WHEN pr.is_membership THEN 'Membresías'
        WHEN pr.cat_model_modality = $2 THEN 'Online'
        ELSE 'En Vivo'
      END AS grupo,
      CASE
        WHEN pr.is_membership THEN
          CASE WHEN COALESCE(pi.installment_number, 0) > 0
               THEN 'Cuota · ' || initcap(pr.program_name)
               ELSE initcap(pr.program_name) END
        WHEN ct.description = 'Curso' THEN 'Cursos'
        WHEN ct.description = 'Especialización' THEN 'Especializaciones'
        WHEN ct.description = 'Diplomado' THEN 'Diplomados'
        ELSE COALESCE(ct.description, 'Otros')
      END AS rubro,
      LEAST(5, 1 + (EXTRACT(day FROM p.payment_date)::int - 1) / 7)::int AS semana,
      SUM(p.amount)::numeric AS ingresos,
      COUNT(*)::int AS ventas
    FROM payments p
    JOIN enrollments e        ON e.enrollment_id = p.enrollment_id AND e.active = 'Y'
    JOIN program_versions pv  ON pv.program_version_id = e.program_version_id
    JOIN programs pr          ON pr.program_id = pv.program_id
    LEFT JOIN catalog ct      ON ct.catalog_id = pr.cat_type_program
    LEFT JOIN payment_installments pi ON pi.installment_id = p.installment_id
    WHERE p.active = 'Y'
      AND p.payment_date >= $1::date
      AND p.payment_date <  ($1::date + INTERVAL '1 month')
      AND e.cat_b2b_doctype IS NULL
      AND COALESCE(e.agent_origin, '') NOT ILIKE '%b2b%'
    GROUP BY 1, 2, 3
    ORDER BY 1, 2, 3
  `, [monthStart, onlineId])
  return rows
}

// Total B2C del mes (para la variación vs. mes anterior).
export async function totalB2C (monthStart) {
  const { rows } = await pool.query(`
    SELECT COALESCE(SUM(p.amount), 0)::numeric AS ingresos, COUNT(*)::int AS ventas
    FROM payments p
    JOIN enrollments e ON e.enrollment_id = p.enrollment_id AND e.active = 'Y'
    WHERE p.active = 'Y'
      AND p.payment_date >= $1::date
      AND p.payment_date <  ($1::date + INTERVAL '1 month')
      AND e.cat_b2b_doctype IS NULL
      AND COALESCE(e.agent_origin, '') NOT ILIKE '%b2b%'
  `, [monthStart])
  return rows[0]
}
