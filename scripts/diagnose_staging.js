// scripts/diagnose_staging.js
// Reporta estado de matching entre staging y BD real.
// Uso: node scripts/diagnose_staging.js [spreadsheet_id]

import 'dotenv/config'
import { pool } from '../src/config/db.js'

async function run (sql, params = []) {
  const { rows } = await pool.query(sql, params)
  return rows
}

function header (title) {
  console.log(`\n=== ${title} ===`)
}

function table (rows, cols) {
  if (!rows.length) { console.log('  (sin datos)'); return }
  const widths = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length)))
  console.log('  ' + cols.map((c, i) => c.padEnd(widths[i])).join('  '))
  console.log('  ' + widths.map(w => '-'.repeat(w)).join('  '))
  rows.forEach(r => {
    console.log('  ' + cols.map((c, i) => String(r[c] ?? '').padEnd(widths[i])).join('  '))
  })
}

async function main () {
  const sourceFilter = process.argv[2]
  const where = sourceFilter ? 'WHERE source_spreadsheet_id = $1' : ''
  const params = sourceFilter ? [sourceFilter] : []

  header('Totales staging')
  const totals = await run(`
    SELECT
      (SELECT COUNT(*) FROM staging_inscripciones_2026 ${where}) AS inscripciones,
      (SELECT COUNT(*) FROM staging_cuotas_2026 ${where})        AS cuotas,
      (SELECT COUNT(DISTINCT cod) FROM staging_inscripciones_2026 ${where}) AS cods_distintos,
      (SELECT COUNT(DISTINCT dni) FROM staging_inscripciones_2026 ${where}) AS dnis_distintos
  `, params)
  console.log(totals[0])

  header('Match de COD contra program_versions.version_code')
  const codMatch = await run(`
    SELECT
      COUNT(*) FILTER (WHERE pv.program_version_id IS NOT NULL) AS matchean,
      COUNT(*) FILTER (WHERE pv.program_version_id IS NULL)     AS huerfanos,
      COUNT(DISTINCT s.cod) FILTER (WHERE pv.program_version_id IS NULL) AS cods_huerfanos_distintos
    FROM staging_inscripciones_2026 s
    LEFT JOIN public.program_versions pv ON pv.version_code = s.cod
    ${where}
  `, params)
  console.log(codMatch[0])

  header('COD huerfanos (primeros 10)')
  const codOrphans = await run(`
    SELECT s.cod, COUNT(*) AS filas
    FROM staging_inscripciones_2026 s
    LEFT JOIN public.program_versions pv ON pv.version_code = s.cod
    ${where ? where + ' AND' : 'WHERE'} pv.program_version_id IS NULL
    GROUP BY s.cod
    ORDER BY filas DESC
    LIMIT 10
  `, params)
  table(codOrphans, ['cod', 'filas'])

  header('Match de ED (edicion) contra program_editions')
  const edMatch = await run(`
    WITH ed_samples AS (
      SELECT s.ed, s.cod, COUNT(*) AS filas
      FROM staging_inscripciones_2026 s
      ${where}
      GROUP BY s.ed, s.cod
    )
    SELECT
      es.ed,
      es.cod,
      es.filas,
      (SELECT COUNT(*) FROM program_editions pe
        JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
        WHERE pv.version_code = es.cod
          AND (pe.code_version = es.ed OR pe.global_code = es.ed OR pe.specific_code = es.ed)
      ) AS matches_en_bd
    FROM ed_samples es
    ORDER BY es.filas DESC
    LIMIT 10
  `, params)
  table(edMatch, ['ed', 'cod', 'filas', 'matches_en_bd'])

  header('Match de DNI contra persons.document_number (via customers)')
  const dniMatch = await run(`
    SELECT
      COUNT(*) FILTER (WHERE c.customer_id IS NOT NULL) AS con_customer,
      COUNT(*) FILTER (WHERE p.person_id IS NOT NULL AND c.customer_id IS NULL) AS solo_person_sin_customer,
      COUNT(*) FILTER (WHERE p.person_id IS NULL)      AS huerfanos_totales,
      COUNT(DISTINCT s.dni) FILTER (WHERE p.person_id IS NULL) AS dnis_huerfanos_distintos
    FROM staging_inscripciones_2026 s
    LEFT JOIN public.persons p   ON p.document_number = s.dni
    LEFT JOIN public.customers c ON c.person_id = p.person_id
    ${where}
  `, params)
  console.log(dniMatch[0])

  header('Match de AS parseado (asesor_alias_clean) contra users.alias')
  const asMatch = await run(`
    SELECT
      COUNT(*) FILTER (WHERE u.user_id IS NOT NULL) AS matchean,
      COUNT(*) FILTER (WHERE u.user_id IS NULL AND s.asesor_alias_clean IS NOT NULL) AS alias_huerfanos,
      COUNT(*) FILTER (WHERE s.asesor_alias_clean IS NULL) AS sin_alias_solo_canal
    FROM staging_inscripciones_2026 s
    LEFT JOIN public.users u ON u.alias = s.asesor_alias_clean
    ${where}
  `, params)
  console.log(asMatch[0])

  header('Distribucion de canal_inferido')
  const canalDist = await run(`
    SELECT canal_inferido, COUNT(*) AS filas
    FROM staging_inscripciones_2026
    ${where}
    GROUP BY canal_inferido
    ORDER BY filas DESC
  `, params)
  table(canalDist, ['canal_inferido', 'filas'])

  header('Alias huerfanos a auto-crear en users (todos)')
  const asOrphans = await run(`
    SELECT s.asesor_alias_clean AS alias, COUNT(*) AS filas,
           MIN(s.asesor) AS ejemplo_raw
    FROM staging_inscripciones_2026 s
    LEFT JOIN public.users u ON u.alias = s.asesor_alias_clean
    ${where ? where + ' AND' : 'WHERE'} u.user_id IS NULL
      AND s.asesor_alias_clean IS NOT NULL
    GROUP BY s.asesor_alias_clean
    ORDER BY filas DESC
  `, params)
  table(asOrphans, ['alias', 'filas', 'ejemplo_raw'])

  header('Distribucion de estados')
  const estados = await run(`
    SELECT
      estado_alumno,
      estado,
      tip_cliente,
      tip_member,
      COUNT(*) AS filas
    FROM staging_inscripciones_2026
    ${where}
    GROUP BY estado_alumno, estado, tip_cliente, tip_member
    ORDER BY filas DESC
    LIMIT 20
  `, params)
  table(estados, ['estado_alumno', 'estado', 'tip_cliente', 'tip_member', 'filas'])

  header('DNIs duplicados (mismo DNI en varias inscripciones)')
  const dups = await run(`
    SELECT dni, nombres_apellidos, COUNT(*) AS inscripciones
    FROM staging_inscripciones_2026
    ${where}
    GROUP BY dni, nombres_apellidos
    HAVING COUNT(*) > 1
    ORDER BY inscripciones DESC
    LIMIT 10
  `, params)
  table(dups, ['dni', 'nombres_apellidos', 'inscripciones'])

  header('Muestras de montos y fechas raras (primeras 5 con formato atipico)')
  const raros = await run(`
    SELECT dni, inicial, saldo, ingreso, c1, fc1, dsct
    FROM staging_inscripciones_2026
    WHERE ${sourceFilter ? 'source_spreadsheet_id = $1 AND' : ''}
      (inicial ~ '[A-Za-z/]' OR c1 ~ '[A-Za-z/]' OR fc1 !~ '^\\d{1,2}/\\d{1,2}/\\d{4}$')
    LIMIT 5
  `, params)
  table(raros, ['dni', 'inicial', 'saldo', 'ingreso', 'c1', 'fc1', 'dsct'])

  await pool.end()
}

main().catch(e => { console.error('ERR:', e.message); process.exit(1) })
