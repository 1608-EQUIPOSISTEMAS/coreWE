import { pool } from '../../../shared/db/pool.js'

// Linea de producto = programs.cat_model_modality. Presencial (2622) queda
// fuera: son los congresos, que tienen sus propios objetivos.
export const LINE_MODALITY = { envivo: 2624, online: 2623 }

// Los programas que ya existian se cargaron de golpe el 21/11/25: su primera
// edicion en el ERP no es un lanzamiento ni su version es una mejora.
const INITIAL_LOAD_DAY = '2025-11-21'
// Fichas de prueba de Producto que siguen activas.
const TEST_PROGRAM = "p.program_name ~* '^(EXAMPLE|PRUEBA)'"
// Una version cargada dentro de la semana del alta es la ficha original, no una mejora.
const SAME_LAUNCH_DAYS = 7

// Lo que el alumno siente como "me cambiaron el curso": fecha, horario o docente.
const SCHEDULE_FIELDS = ['start_date', 'end_date', 'instructor_id', 'cat_day_combination_id', 'cat_hour_combination_id']

const PROGRAM_FILTER = `p.active = 'Y' AND p.is_membership IS NOT TRUE
         AND p.cat_model_modality = $1 AND NOT (${TEST_PROGRAM})`

export class ProductReportRepository {
  constructor (db = pool) {
    this.db = db
  }

  // Fichas creadas en el rango.
  async newPrograms ({ modality, from, to }) {
    const { rows } = await this.db.query(`
      SELECT p.program_name AS programa, to_char(p.registration_date, 'YYYY-MM-DD') AS dia
        FROM programs p
       WHERE ${PROGRAM_FILTER}
         AND p.registration_date::date BETWEEN $2 AND $3
       ORDER BY p.registration_date`, [modality, from, to])
    return rows
  }

  // Programa nuevo cuya primera edicion arranca en el rango.
  async launchedPrograms ({ modality, from, to }) {
    const { rows } = await this.db.query(`
      SELECT p.program_name AS programa, to_char(MIN(pe.start_date), 'YYYY-MM-DD') AS dia
        FROM programs p
        JOIN program_versions v ON v.program_id = p.program_id AND v.active = 'Y'
        JOIN program_editions pe ON pe.program_version_id = v.program_version_id AND pe.active = 'Y'
       WHERE ${PROGRAM_FILTER}
         AND p.registration_date::date > $4
       GROUP BY p.program_id, p.program_name
      HAVING MIN(pe.start_date) BETWEEN $2 AND $3
       ORDER BY 2`, [modality, from, to, INITIAL_LOAD_DAY])
    return rows
  }

  // Operacion del cronograma como eventos { clave, dia }: el entity solo cuenta.
  // Las ediciones son las de la linea; los docentes no tienen linea y van todos.
  async scheduleEvents ({ modality, from, to, today }) {
    const { rows } = await this.db.query(`
      WITH linea AS (
        SELECT pe.edition_num_id, pe.start_date, pe.active,
               ct.alias = 'we_program_type_course' AS es_curso,
               seg.alias = 'we_segment_a5' AS a5
          FROM program_editions pe
          JOIN program_versions v ON v.program_version_id = pe.program_version_id
          JOIN programs p ON p.program_id = v.program_id
          LEFT JOIN catalog ct ON ct.catalog_id = p.cat_type_program
          LEFT JOIN catalog seg ON seg.catalog_id = pe.cat_segment
         WHERE p.cat_model_modality = $1 AND NOT (${TEST_PROGRAM})
      ),
      -- Seguimiento = el curso es el 2do modulo en adelante de algun paquete.
      seguimiento AS (
        SELECT DISTINCT child_edition_id
          FROM (SELECT child_edition_id, sort_order,
                       MIN(sort_order) OVER (PARTITION BY parent_edition_id) AS primero
                  FROM edition_structure) s
         WHERE sort_order > primero
      )
      -- Cursos por mes de inicio. Sin filtro de active para la A5: cancelar
      -- suele inactivar la edicion y se esconderia justo lo que se cuenta.
      SELECT unnest(ARRAY['programados']
                    || CASE WHEN l.a5 THEN ARRAY['a5'] ELSE '{}' END
                    || CASE WHEN s.child_edition_id IS NOT NULL AND NOT COALESCE(l.a5, false) THEN ARRAY['seguimientos'] ELSE '{}' END) AS clave,
             to_char(l.start_date, 'YYYY-MM-DD') AS dia
        FROM linea l
        LEFT JOIN seguimiento s ON s.child_edition_id = l.edition_num_id
       WHERE l.es_curso AND (l.active = 'Y' OR l.a5)
         AND l.start_date BETWEEN $2 AND $3
      UNION ALL
      -- Meta de ventas por edicion con la regla de Gerencia (v_gerencia_funnel),
      -- paquetes incluidos: ahi se registra su venta. Solo se juzga la que ya
      -- arranco; antes de eso todavia esta vendiendo.
      SELECT CASE WHEN f.ventas >= f.meta_ventas THEN 'meta_ok' ELSE 'meta_no' END,
             to_char(f.fecha_inicio, 'YYYY-MM-DD')
        FROM v_gerencia_funnel f
        JOIN linea l ON l.edition_num_id = f.edition_num_id
       WHERE f.meta_ventas > 0 AND NOT COALESCE(l.a5, false)
         AND f.fecha_inicio BETWEEN $2 AND LEAST($3::date, $4::date - 1)
      UNION ALL
      -- Cambio de fecha, horario o docente a una edicion. audit_logs empieza el 25/08/26.
      -- Cuenta EDICIONES (el KPI dice "ediciones"): una movida tres veces en el
      -- periodo cuenta una, el dia de su primer cambio.
      SELECT 'cambios', to_char(MIN(a.created_at), 'YYYY-MM-DD')
        FROM audit_logs a
        JOIN linea l ON l.edition_num_id = a.record_id
       WHERE a.table_name = 'program_editions' AND a.action = 'UPDATE'
         AND a.changed_fields ?| $5::text[]
         AND a.created_at >= $2 AND a.created_at < $3::date + 1
       GROUP BY a.record_id
      UNION ALL
      SELECT 'docentes', to_char(i.registration_date, 'YYYY-MM-DD')
        FROM instructors i
       WHERE i.active = 'Y' AND i.registration_date >= $2 AND i.registration_date < $3::date + 1`,
    [modality, from, to, today, SCHEDULE_FIELDS])
    return rows
  }

  // Curso mejorado = version nueva (V2, V5...) de un programa que ya existia.
  async improvedPrograms ({ modality, from, to }) {
    const { rows } = await this.db.query(`
      SELECT p.program_name AS programa, COALESCE(v.abbreviation, v.version_code) AS version,
             to_char(v.registration_date, 'YYYY-MM-DD') AS dia
        FROM program_versions v
        JOIN programs p ON p.program_id = v.program_id
       WHERE ${PROGRAM_FILTER}
         AND v.active = 'Y'
         AND v.registration_date::date > p.registration_date::date + $4::int
         AND v.registration_date::date BETWEEN $2 AND $3
       ORDER BY v.registration_date`, [modality, from, to, SAME_LAUNCH_DAYS])
    return rows
  }
}

export const productReportRepository = new ProductReportRepository()
