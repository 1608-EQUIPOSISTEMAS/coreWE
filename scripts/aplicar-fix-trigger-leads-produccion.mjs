// Aplica fix-trigger-leads-permite-desenganche.sql en PRODUCCION (tunel 55432).
// Guarda la version vigente del candado antes de pisarla, por si hay que volver.
import fs from 'node:fs'
import { pool } from './db.mjs'

const client = await pool.connect()
try {
  const destino = (await client.query('SELECT current_database() db, inet_server_port() port')).rows[0]
  console.log(`BD destino: ${destino.db}:${destino.port}`)

  const previo = (await client.query(
    "SELECT pg_get_functiondef(oid) src FROM pg_proc WHERE proname='trg_block_update_if_enrolled'")).rows[0].src
  const respaldo = 'scripts/_backup_trg_block_update_if_enrolled_2026-09-02.sql'
  fs.writeFileSync(respaldo, previo)
  console.log(`respaldo del candado vigente -> ${respaldo}`)

  await client.query(fs.readFileSync('scripts/fix-trigger-leads-permite-desenganche.sql', 'utf8'))

  const nuevo = (await client.query(
    "SELECT pg_get_functiondef(oid) src FROM pg_proc WHERE proname='trg_block_update_if_enrolled'")).rows[0].src
  if (!/NEW\.enrollment_id IS NULL/.test(nuevo)) throw new Error('El arreglo no quedo instalado')

  const { rows: t } = await client.query(
    "SELECT tgenabled FROM pg_trigger WHERE tgrelid='leads'::regclass AND tgname='block_update_when_enrolled'")
  console.log(`trigger block_update_when_enrolled: ${t[0].tgenabled === 'O' ? 'HABILITADO' : `ESTADO ${t[0].tgenabled}`}`)
  console.log('\nOK: arreglo aplicado en produccion.')
} catch (err) {
  console.error('FALLO:', err.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
