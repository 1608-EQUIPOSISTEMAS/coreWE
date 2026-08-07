// Verifica el estado final del flujo de beneficios/badge tras el despliegue:
//   1. los dos SP en produccion traen la regla (v_ben_solo_badge),
//   2. el SP de FICO ya escribe enrollment_discounts,
//   3. las inscripciones con CUENTA CLAUDE disparan el badge en la matview,
//      que es de donde lo lee el panel.
import { q, pool } from './db.mjs'

const { rows: sps } = await q(`
  SELECT p.proname,
         pg_get_functiondef(p.oid) ~ 'v_ben_solo_badge'    AS tiene_regla,
         pg_get_functiondef(p.oid) ~ 'enrollment_discounts' AS escribe_desglose
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('sp_comercial_enrollment_register', 'sp_fico_enrollment_register_direct')
  ORDER BY 1
`)
console.log('=== SP en produccion ===')
console.table(sps)

const { rows: badges } = await q(`
  SELECT "ID"::int AS enrollment_id, "DSTC. PRINCIPAL" AS main_discount,
         "DSTC'S ADICIONALES" AS additional_discounts
  FROM public.mv_enrollment_report_system
  WHERE (COALESCE("DSTC. PRINCIPAL"::TEXT,'') || ' ' || COALESCE("DSTC'S ADICIONALES"::TEXT,''))
        ~* 'CUENTA\\s+CLAUDE'
  ORDER BY 1
`)
console.log(`\n=== inscripciones con badge CUENTA PERSONAL (${badges.length}) ===`)
console.table(badges)
console.log(badges.some(b => b.enrollment_id === 15900)
  ? '15900 presente.'
  : '15900 AUSENTE: revisar (falta refresh de la matview?).')

await pool.end()
