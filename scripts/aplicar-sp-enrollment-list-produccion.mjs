// Aplica scripts/sp_fico_enrollment_list.sql en PRODUCCION.
//
// Antes respalda la definicion vigente en scripts/_backup_sp_fico_enrollment_list_<fecha>.sql
// (mismo patron que los otros _backup_*.sql del repo) para poder volver atras con
// un solo CREATE OR REPLACE. El tunel se cae seguido, asi que reintenta.
//
//   node scripts/aplicar-sp-enrollment-list-produccion.mjs --aplicar
import fs from 'node:fs'
import { q, pool } from './prod-db.mjs'

const APLICAR = process.argv.includes('--aplicar')
const FECHA = new Date().toISOString().slice(0, 10)
const RESPALDO = new URL(`./_backup_sp_fico_enrollment_list_${FECHA}.sql`, import.meta.url)

const reintentar = async (nombre, fn, intentos = 3) => {
  for (let i = 1; i <= intentos; i++) {
    try { return await fn() } catch (e) {
      if (i === intentos) throw e
      console.warn(`[${nombre}] intento ${i} fallo (${e.message}); reintento...`)
    }
  }
}

const definicionVigente = () => reintentar('respaldo', async () => {
  const { rows } = await q(`
    SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
     WHERE p.proname = 'sp_fico_enrollment_list'`)
  if (!rows[0]) throw new Error('no existe sp_fico_enrollment_list en produccion')
  return rows[0].def
})

const yaTieneElCambio = (def) => def.includes('uventa')

const vigente = await definicionVigente()
console.log('Definicion vigente en produccion:', vigente.length, 'caracteres')
console.log('¿Ya tiene el cambio?', yaTieneElCambio(vigente) ? 'SI' : 'no')

if (!fs.existsSync(RESPALDO)) {
  fs.writeFileSync(RESPALDO, `-- Respaldo de sp_fico_enrollment_list tal como estaba en PRODUCCION\n-- antes del cambio del asesor heredado (${FECHA}).\n-- Para revertir: correr este archivo tal cual.\n${vigente};\n`)
  console.log('Respaldo escrito en', RESPALDO.pathname.split('/').pop())
}

if (!APLICAR) {
  console.log('\nMODO SECO. Para aplicar: node scripts/aplicar-sp-enrollment-list-produccion.mjs --aplicar')
  await pool.end()
  process.exit(0)
}

const nuevo = fs.readFileSync(new URL('./sp_fico_enrollment_list.sql', import.meta.url), 'utf8')
await reintentar('aplicar', () => q(nuevo))
console.log('\nSP aplicado.')

const despues = await definicionVigente()
console.log('Verificacion — ¿quedo el cambio?', yaTieneElCambio(despues) ? 'SI' : 'NO (revisar)')

await pool.end()
