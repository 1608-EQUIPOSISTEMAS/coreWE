// Paso 1: respaldo del SP actual + despliegue de fn_person_resolve (inerte).
// El tunel se cae seguido: todo va en UNA conexion y es idempotente.
import fs from 'node:fs'
import { pool } from './db.mjs'

const c = await pool.connect()
try {
  const { rows: [sp] } = await c.query(`
    SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'sp_fico_enrollment_register_direct'`)
  const backup = 'scripts/_sp_register_direct_backup_2026-08-03.sql'
  fs.writeFileSync(backup, sp.def, 'utf8')
  console.log(`respaldo SP -> ${backup} (${sp.def.length} bytes)`)

  await c.query(fs.readFileSync('scripts/fn_person_resolve.sql', 'utf8'))
  console.log('desplegadas: fn_txt_key, fn_doc_key, fn_person_resolve')

  // Pruebas de la cascada, TODO dentro de una transaccion que se revierte.
  await c.query('BEGIN')
  const t = async (label, sql, params) => {
    const { rows: [r] } = await c.query(sql, params)
    console.log(`  ${label}: ${JSON.stringify(r)}`)
    return r
  }
  console.log('\npruebas (se revierten):')
  await t('doc con ceros 03893811 == 3893811',
    "SELECT public.fn_doc_key('3893811') = public.fn_doc_key('03893811') AS ok")
  await t('RUC 11 digitos intacto', "SELECT public.fn_doc_key('20512345678') AS doc")
  await t('acentos/espacios', "SELECT public.fn_txt_key('  Ángel   Sergio ') AS k")

  const antes = (await c.query('SELECT COUNT(*)::int n FROM public.persons')).rows[0].n
  await t('por documento -> persona con DNI (19685)',
    "SELECT public.fn_person_resolve('72569421', 2300, 'ANGEL SERGIO', 'GABRIEL RECAVARREN', 'angelsgabrielr97@gmail.com', 9) AS person_id")
  await t('DNI con cero extra (072569421) -> ¿mismo?',
    "SELECT public.fn_person_resolve('072569421', 2300, 'ANGEL SERGIO', 'GABRIEL RECAVARREN', 'angelsgabrielr97@gmail.com', 9) AS person_id")
  await t('sin doc, gemelos aun existen -> ambiguo, crea nueva',
    "SELECT public.fn_person_resolve(NULL, NULL, 'ANGEL SERGIO', 'GABRIEL RECAVARREN', 'angelsgabrielr97@gmail.com', 9) AS person_id")
  await t('familia real (apellido distinto) NO se fusiona',
    "SELECT public.fn_person_resolve(NULL, NULL, 'FRANKLIN JUNIOR', 'SANCHEZ', 'elizabeth.condor.pe@gmail.com', 9) AS person_id")
  const despues = (await c.query('SELECT COUNT(*)::int n FROM public.persons')).rows[0].n
  console.log(`  personas creadas en la prueba: ${despues - antes} (esperado 2: el ambiguo y la familia)`)
  await c.query('ROLLBACK')
  console.log('rollback ok — la BD quedo igual')
} catch (e) {
  await c.query('ROLLBACK').catch(() => {})
  throw e
} finally {
  c.release()
  await pool.end()
}
