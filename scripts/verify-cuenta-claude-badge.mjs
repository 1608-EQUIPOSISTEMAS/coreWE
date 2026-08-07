// Verifica que el badge CUENTA PERSONAL se dispare de verdad.
//
// Cadena real: sp_fico_enrollment_list expone
//   main_discount        <- v."DSTC. PRINCIPAL"
//   additional_discounts <- v."DSTC'S ADICIONALES"
// y el frontend hace /CUENTA\s+CLAUDE/ sobre esos dos campos
// (useEnrollmentFormatters.hasClaudeAccount). Lo que hay que confirmar es si esa
// vista incluye los descuentos con calculated_amount = 0.
import { q, pool } from './db.mjs'

const IDS = [13946, 14054, 14523, 14766, 15658, 9474, 13827]

// Que es "v" dentro del SP.
const { rows: [{ def }] } = await q(`
  SELECT pg_get_functiondef(p.oid) AS def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'sp_fico_enrollment_list' LIMIT 1
`)
const from = def.split('\n').filter(l => /\bv\b\s*$|FROM\s+\w+\s+v|JOIN\s+\S+\s+v\b/i.test(l))
console.log('origen de v:\n' + from.join('\n'))

// Estado real de las columnas que lee el frontend.
const { rows } = await q(`
  SELECT "ID" AS enrollment_id, "DSTC. PRINCIPAL" AS main_discount,
         "DSTC'S ADICIONALES" AS additional_discounts,
         (COALESCE("DSTC. PRINCIPAL"::TEXT,'') || ' ' || COALESCE("DSTC'S ADICIONALES"::TEXT,''))
           ~* 'CUENTA\\s+CLAUDE' AS badge_visible
  FROM public.mv_enrollment_report_system
  WHERE "ID"::INT = ANY($1::int[])
  ORDER BY 1
`, [IDS])
console.table(rows)

await pool.end()
