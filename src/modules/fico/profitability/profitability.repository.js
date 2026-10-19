import { pool, withTransaction } from '../../../shared/db/pool.js'
import { RP_LINK_CTE } from '../../integration/integration.repository.js'
import { SALE_DATES_CTES, SALE_DATE, SALE_JOINS } from '../../plancomercial/plancomercial.repository.js'
import { inSoles } from '../report/report.repository.js'

const CHECKED = 3052
const ANNULLED = 3135
// Fuera del aula: no cuentan para repartir el costo de la edicion.
const LEFT_CLASSROOM = [3135, 3245, 3240, 3242] // anulada, retirado, RP, CC
const EDITION_CANCELLED = 2486
const LINE = { B2B: 3228, FUNDACION: 3227, ONLINE: 3226 }
const ONLINE_MODALITY = 2623

// Unidad del programa: la linea de negocio que le puso Producto; sin linea, la
// modalidad online lo manda a Online y el resto es En Vivo.
const programLine = p => `CASE
    WHEN ${p}.cat_business_line_id = ${LINE.B2B} THEN 'B2B'
    WHEN ${p}.cat_business_line_id = ${LINE.FUNDACION} THEN 'FUNDACION'
    WHEN ${p}.cat_business_line_id = ${LINE.ONLINE} OR ${p}.cat_model_modality = ${ONLINE_MODALITY} THEN 'ONLINE'
    ELSE 'ENVIVO' END`
// Unidad de la VENTA: un curso vendido por convenio es ingreso B2B y uno vendido
// por Fundacion es de Fundacion, aunque el programa sea En Vivo (asi corta contabilidad).
const saleLine = (e, p) => `CASE
    WHEN ${e}.agent_origin = 'B2B' OR ${e}.b2b_contract_id IS NOT NULL THEN 'B2B'
    WHEN ${e}.agent_origin = 'FWE' THEN 'FUNDACION'
    ELSE ${programLine(p)} END`

// Una venta = la inscripcion raiz aprobada por FICO y con monto (sin becas). El
// destino de una RP no es venta nueva; el de un CC cuelga del origen. Requiere
// rp_link en el WITH y el alias e.
const IS_SOLD = `
         e.active = 'Y' AND e.parent_enrollment_id IS NULL
     AND e.cat_fico_status = ${CHECKED}
     AND COALESCE(e.cat_type_status, 0) <> ${ANNULLED}
     AND COALESCE(e.total_amount, 0) > 0
     AND NOT EXISTS (SELECT 1 FROM rp_link WHERE rp_link.destino_id = e.enrollment_id)`

export const profitabilityRepository = {
  db: pool,

  // Vendido: monto de la venta en soles por F. PAGO (la de la hoja FICO).
  async salesSold ({ from, to }) {
    const { rows } = await this.db.query(`
      WITH ${RP_LINK_CTE}, ${SALE_DATES_CTES}
      SELECT to_char(${SALE_DATE}, 'YYYY-MM-DD') AS dia,
             ${saleLine('e', 'p')} AS linea,
             COALESCE(ct.description, 'Sin tipo') AS tipo,
             p.program_id, p.program_name AS programa,
             COUNT(*)::int AS n,
             SUM(${inSoles('e.total_amount')})::float8 AS soles
        FROM public.enrollments e ${SALE_JOINS}
        LEFT JOIN public."catalog" ct ON ct.catalog_id = p.cat_type_program
       WHERE ${IS_SOLD}
         AND ${SALE_DATE} BETWEEN $1::date AND $2::date
       GROUP BY 1, 2, 3, 4, 5`, [from, to])
    return rows
  },

  // Cobrado: la plata que entro en el periodo (inicial y cuotas, de ventas de
  // cualquier fecha), cargada al programa de la venta raiz. n = pagos.
  async salesCollected ({ from, to }) {
    const { rows } = await this.db.query(`
      SELECT to_char(py.payment_date, 'YYYY-MM-DD') AS dia,
             ${saleLine('e', 'p')} AS linea,
             COALESCE(ct.description, 'Sin tipo') AS tipo,
             p.program_id, p.program_name AS programa,
             COUNT(*)::int AS n,
             SUM(${inSoles('py.amount')})::float8 AS soles
        FROM public.payments py
        JOIN public.enrollments paid ON paid.enrollment_id = py.enrollment_id
        JOIN public.enrollments e ON e.enrollment_id = COALESCE(paid.parent_enrollment_id, paid.enrollment_id)
        JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
        JOIN public.programs p ON p.program_id = pv.program_id
        LEFT JOIN public."catalog" ct ON ct.catalog_id = p.cat_type_program
       WHERE py.active = 'Y' AND e.active = 'Y'
         AND py.payment_date >= $1::date AND py.payment_date < $2::date + 1
       GROUP BY 1, 2, 3, 4, 5`, [from, to])
    return rows
  },

  // Ediciones que inician en el periodo, con lo necesario para su costo docente
  // y el reparto de alumnos por programa VENDIDO (padre si es hijo de paquete).
  // El padre de un paquete no se dicta: su costo esta en las ediciones hijas.
  async editionsStarting ({ from, to }) {
    const { rows } = await this.db.query(`
      WITH ed AS (
        SELECT pe.edition_num_id, pe.instructor_id, pe.start_date, pv.sessions,
               hc.alias AS horario, p.program_id, p.program_name, ${programLine('p')} AS linea,
               COALESCE(ct.description, 'Sin tipo') AS tipo
          FROM public.program_editions pe
          JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
          JOIN public.programs p ON p.program_id = pv.program_id
          LEFT JOIN public."catalog" ct ON ct.catalog_id = p.cat_type_program
          LEFT JOIN public."catalog" hc ON hc.catalog_id = pe.cat_hour_combination_id
         WHERE pe.active = 'Y'
           AND COALESCE(pe.cat_status_edition, 0) <> ${EDITION_CANCELLED}
           AND pe.start_date BETWEEN $1::date AND $2::date
           AND NOT EXISTS (SELECT 1 FROM public.edition_structure es WHERE es.parent_edition_id = pe.edition_num_id)
      ),
      alumnos AS (
        SELECT e.program_edition_id AS edition_id,
               ${saleLine('sold', 'sp')} AS linea, sp.program_id, sp.program_name AS programa,
               COALESCE(sct.description, 'Sin tipo') AS tipo, COUNT(*)::int AS n
          FROM public.enrollments e
          JOIN public.enrollments sold ON sold.enrollment_id = COALESCE(e.parent_enrollment_id, e.enrollment_id)
          JOIN public.program_versions spv ON spv.program_version_id = sold.program_version_id
          JOIN public.programs sp ON sp.program_id = spv.program_id
          LEFT JOIN public."catalog" sct ON sct.catalog_id = sp.cat_type_program
         WHERE e.active = 'Y' AND e.cat_fico_status = ${CHECKED}
           AND COALESCE(e.cat_type_status, 0) <> ALL($3::int[])
           AND e.program_edition_id IN (SELECT edition_num_id FROM ed)
         GROUP BY 1, 2, 3, 4, 5
      )
      SELECT ed.edition_num_id AS edition_id, ed.instructor_id, ed.sessions AS sesiones, ed.horario,
             ed.program_id, ed.program_name AS programa, ed.linea, ed.tipo,
             r.hourly_rate::float8 AS tarifa,
             COALESCE(json_agg(json_build_object('linea', a.linea, 'program_id', a.program_id,
                        'programa', a.programa, 'tipo', a.tipo, 'n', a.n))
                      FILTER (WHERE a.program_id IS NOT NULL), '[]') AS reparto
        FROM ed
        LEFT JOIN public.fico_instructor_rates r ON r.instructor_id = ed.instructor_id
        LEFT JOIN alumnos a ON a.edition_id = ed.edition_num_id
       GROUP BY ed.edition_num_id, ed.instructor_id, ed.sessions, ed.horario, ed.program_id,
                ed.program_name, ed.linea, ed.tipo, r.hourly_rate`, [from, to, LEFT_CLASSROOM])
    return rows
  },

  async marketingSpend ({ from, to }) {
    const { rows } = await this.db.query(`
      SELECT to_char(month, 'YYYY-MM') AS mes, business_line AS linea, amount::float8 AS amount
        FROM public.fico_marketing_spend
       WHERE month BETWEEN date_trunc('month', $1::date) AND $2::date`, [from, to])
    return rows
  },

  // Docentes con ediciones en el año (los que generan costo) o con tarifa ya
  // cargada, con cuantas ediciones dictan: se completa primero al que mas dicta.
  async instructorRates ({ year }) {
    const { rows } = await this.db.query(`
      WITH dicta AS (
        SELECT pe.instructor_id, COUNT(*)::int AS ediciones
          FROM public.program_editions pe
         WHERE pe.active = 'Y' AND pe.instructor_id IS NOT NULL
           AND COALESCE(pe.cat_status_edition, 0) <> ${EDITION_CANCELLED}
           AND EXTRACT(YEAR FROM pe.start_date) = $1
           AND NOT EXISTS (SELECT 1 FROM public.edition_structure es WHERE es.parent_edition_id = pe.edition_num_id)
         GROUP BY 1
      )
      SELECT i.instructor_id,
             TRIM(CONCAT_WS(' ', per.first_name, per.last_name)) AS docente,
             COALESCE(d.ediciones, 0) AS ediciones,
             r.hourly_rate::float8 AS tarifa
        FROM public.instructors i
        JOIN public.persons per ON per.person_id = i.person_id
        LEFT JOIN dicta d ON d.instructor_id = i.instructor_id
        LEFT JOIN public.fico_instructor_rates r ON r.instructor_id = i.instructor_id
       WHERE d.instructor_id IS NOT NULL OR r.instructor_id IS NOT NULL
       ORDER BY (r.hourly_rate IS NULL) DESC, ediciones DESC, docente`, [year])
    return rows
  },

  async marketingYear ({ year }) {
    const { rows } = await this.db.query(`
      SELECT EXTRACT(MONTH FROM month)::int AS month, business_line AS line, amount::float8 AS amount
        FROM public.fico_marketing_spend
       WHERE EXTRACT(YEAR FROM month) = $1`, [year])
    return rows
  },

  // Tarifa null = se borra: el docente vuelve a "sin tarifa".
  async saveInstructorRate ({ instructorId, rate, userId }) {
    if (rate === null) {
      await this.db.query('DELETE FROM public.fico_instructor_rates WHERE instructor_id = $1', [instructorId])
      return
    }
    await this.db.query(`
      INSERT INTO public.fico_instructor_rates (instructor_id, hourly_rate, user_modification_id, modification_date)
      VALUES ($1, $2, $3, now())
      ON CONFLICT (instructor_id) DO UPDATE
         SET hourly_rate = EXCLUDED.hourly_rate,
             user_modification_id = EXCLUDED.user_modification_id,
             modification_date = now()`, [instructorId, rate, userId])
  },

  async saveMarketing ({ rows, userId }) {
    await withTransaction(async client => {
      for (const r of rows) {
        await client.query(`
          INSERT INTO public.fico_marketing_spend (month, business_line, amount, user_modification_id, modification_date)
          VALUES ($1::date, $2, $3, $4, now())
          ON CONFLICT (month, business_line) DO UPDATE
             SET amount = EXCLUDED.amount,
                 user_modification_id = EXCLUDED.user_modification_id,
                 modification_date = now()`, [r.month, r.line, r.amount, userId])
      }
    })
  }
}
