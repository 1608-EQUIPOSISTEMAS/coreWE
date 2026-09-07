// ¿Cuantos padres de paquete se quedaron sin hijos y por lo tanto fuera de toda
// aula? El conteo grueso (edicion NULL + paquete + sin hijos) mete ruido:
//   - ventas no aprobadas todavia por FICO (no son ventas aun),
//   - retiradas / cambiadas de curso / reprogramadas (ya no asisten),
//   - CONVALIDADAS de verdad: si todos los modulos estan convalidados el alumno
//     no genera hijos, y eso es correcto por diseno.
// Este script los descuenta y ordena por fecha, para ver si el problema toca al
// cronograma de aqui en adelante o es pasivo viejo.
import { q, pool } from './prod-db.mjs'

const BASE = `
  FROM enrollments e
  JOIN program_versions pv ON pv.program_version_id = e.program_version_id
  JOIN catalog cf ON cf.catalog_id = e.cat_fico_status
  LEFT JOIN catalog cts ON cts.catalog_id = e.cat_type_status
 WHERE e.active = 'Y'
   AND e.program_edition_id IS NULL
   AND EXISTS (SELECT 1 FROM program_version_structure s
                WHERE s.parent_program_version_id = pv.program_version_id)
   AND NOT EXISTS (SELECT 1 FROM enrollments h
                    WHERE h.parent_enrollment_id = e.enrollment_id AND h.active = 'Y')`

const APROBADA = `AND cf.alias = 'we_enrollment_status_checked'`
const VIVA = `AND (cts.alias IS NULL OR cts.alias NOT IN (
                'we_enrollment_status_retired','we_enrollment_status_course_changed',
                'we_enrollment_status_reprogrammed'))`
// Convalidacion real = tiene tantas validaciones como modulos tiene el paquete.
const NO_CONVALIDADA = `
   AND (SELECT COUNT(*) FROM enrollment_validations ev WHERE ev.enrollment_id = e.enrollment_id)
     < (SELECT COUNT(*) FROM program_version_structure s2
         WHERE s2.parent_program_version_id = pv.program_version_id)`

const contar = async (extra) => (await q(`SELECT COUNT(*)::int AS n ${BASE} ${extra}`)).rows[0].n

console.log('Padres de paquete sin hijos, filtrando de a poco:')
console.table([
  { filtro: '1. conteo grueso (el que reporte)', padres: await contar('') },
  { filtro: '2. + solo aprobadas por FICO', padres: await contar(APROBADA) },
  { filtro: '3. + sin retiradas / CC / RP', padres: await contar(`${APROBADA} ${VIVA}`) },
  { filtro: '4. + sin las convalidadas por completo', padres: await contar(`${APROBADA} ${VIVA} ${NO_CONVALIDADA}`) }
])

const { rows } = await q(`
  SELECT to_char(date_trunc('month', e.registration_date), 'YYYY-MM') AS mes,
         COUNT(*)::int AS padres,
         SUM(e.total_amount)::numeric AS soles,
         COUNT(*) FILTER (WHERE (SELECT COUNT(*) FROM enrollment_validations ev
                                  WHERE ev.enrollment_id = e.enrollment_id) > 0)::int AS con_alguna_convalidacion
  ${BASE} ${APROBADA} ${VIVA} ${NO_CONVALIDADA}
   GROUP BY 1 ORDER BY 1`)
console.log('\nLos que quedan, por mes de venta:')
console.table(rows)

const { rows: muestra } = await q(`
  SELECT e.enrollment_id AS id, e.registration_date::date AS venta,
         (SELECT TRIM(concat_ws(' ', p2.first_name, p2.last_name))
            FROM customers c2 JOIN persons p2 ON p2.person_id = c2.person_id
           WHERE c2.customer_id = e.customer_id) AS alumno,
         pv.abbreviation AS paquete, e.total_amount::numeric AS total,
         (SELECT COUNT(*) FROM program_version_structure s2
           WHERE s2.parent_program_version_id = pv.program_version_id)::int AS modulos,
         (SELECT COUNT(*) FROM enrollment_validations ev WHERE ev.enrollment_id = e.enrollment_id)::int AS convalidados
  ${BASE} ${APROBADA} ${VIVA} ${NO_CONVALIDADA}
   ORDER BY e.registration_date DESC LIMIT 10`)
console.log('\nLos 10 mas recientes:')
console.table(muestra)


// ¿Estos alumnos estan de verdad fuera del aula, o entraron por otra via?
const { rows: cruce } = await q(`
  WITH huerfanos AS (
    SELECT e.enrollment_id, e.customer_id, e.registration_date, pv.program_version_id AS paquete_pv
    ${BASE} ${APROBADA} ${VIVA} ${NO_CONVALIDADA}
  )
  SELECT CASE WHEN EXISTS (
           -- otra inscripcion activa y aprobada de esa persona en algun modulo
           -- del mismo paquete, posterior o igual a la venta huerfana
           SELECT 1
             FROM enrollments o
             JOIN customers co ON co.customer_id = o.customer_id
             JOIN customers ch ON ch.customer_id = h.customer_id AND ch.person_id = co.person_id
             JOIN catalog cfo ON cfo.catalog_id = o.cat_fico_status AND cfo.alias = 'we_enrollment_status_checked'
             JOIN program_version_structure s ON s.parent_program_version_id = h.paquete_pv
                                             AND s.child_program_version_id = o.program_version_id
            WHERE o.active = 'Y' AND o.enrollment_id <> h.enrollment_id
              AND o.program_edition_id IS NOT NULL
         ) THEN 'SI esta en un aula (inscripcion suelta del modulo)'
         ELSE 'NO aparece en ninguna aula'
    END AS situacion,
    COUNT(*)::int AS alumnos
    FROM huerfanos h GROUP BY 1 ORDER BY alumnos DESC`)
console.log('\n¿Estan realmente fuera del aula?')
console.table(cruce)

await pool.end()