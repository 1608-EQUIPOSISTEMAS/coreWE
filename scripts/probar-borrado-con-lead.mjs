// Prueba de trg_block_update_if_enrolled contra la BD que apunte DATABASE_URL.
// Es autocontenida y repetible: instala la version ORIGINAL del candado, verifica
// que bloquea el desenganche, instala el arreglo y verifica que ya no bloquea
// pero sigue congelando el resto del lead. Todo dentro de transacciones que
// terminan en ROLLBACK; al final restaura el candado que traia la BD.
import fs from 'node:fs'
import { pool } from './db.mjs'

const client = await pool.connect()
const destino = (await client.query('SELECT current_database() db, inet_server_port() port')).rows[0]
console.log(`BD: ${destino.db}:${destino.port}\n`)

const candadoOriginal = (await client.query(
  "SELECT pg_get_functiondef(oid) src FROM pg_proc WHERE proname='trg_block_update_if_enrolled'")).rows[0].src
const candadoArreglado = fs.readFileSync('scripts/fix-trigger-leads-permite-desenganche.sql', 'utf8')

const candadoSinDesenganche = `
CREATE OR REPLACE FUNCTION public.trg_block_update_if_enrolled() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  IF OLD.enrollment_id IS NOT NULL THEN
    IF to_jsonb(NEW) - 'pay_date' - 'origin_email' - 'origin_phone' - 'user_modification_id'
     = to_jsonb(OLD) - 'pay_date' - 'origin_email' - 'origin_phone' - 'user_modification_id' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'No se puede modificar el lead % porque ya tiene enrollment_id (%).', OLD.lead_id, OLD.enrollment_id;
  END IF;
  RETURN NEW;
END; $f$;`

const { enrollment_id: ID, lead_id: LEAD } = (await client.query(
  'SELECT enrollment_id, lead_id FROM leads WHERE enrollment_id IS NOT NULL ORDER BY lead_id DESC LIMIT 1')).rows[0]
console.log(`cobaya: enrollment ${ID} <- lead ${LEAD}\n`)

// Corre el UPDATE en una transaccion que siempre se revierte y dice si paso.
const pasa = async (sql, params) => {
  await client.query('BEGIN')
  try {
    await client.query(sql, params)
    return true
  } catch (err) {
    if (!/ya tiene enrollment_id/.test(err.message)) throw err
    return false
  } finally {
    await client.query('ROLLBACK')
  }
}

const DESENGANCHAR = `UPDATE leads SET enrollment_id = NULL,
    cat_status_lead = COALESCE((SELECT catalog_id FROM catalog WHERE alias='we_lead_status_atendido' LIMIT 1), cat_status_lead)
  WHERE enrollment_id = $1`
const TOCAR_OTRO_CAMPO = 'UPDATE leads SET observations = COALESCE(observations, \'\') || \'X\' WHERE lead_id = $1'

try {
  await client.query(candadoSinDesenganche)
  const bloqueabaAntes = !(await pasa(DESENGANCHAR, [ID]))
  console.log(`  con el candado viejo, desenganchar el lead: ${bloqueabaAntes ? 'BLOQUEA (el bug)' : 'pasa'}`)

  await client.query(candadoArreglado)
  const desengancha = await pasa(DESENGANCHAR, [ID])
  const sigueCongelado = !(await pasa(TOCAR_OTRO_CAMPO, [LEAD]))
  console.log(`  con el arreglo, desenganchar el lead:      ${desengancha ? 'PASA' : 'BLOQUEA'}`)
  console.log(`  con el arreglo, tocar otro campo del lead: ${sigueCongelado ? 'BLOQUEA (sigue congelado)' : 'PASA'}`)

  const ok = bloqueabaAntes && desengancha && sigueCongelado
  console.log(`\n${ok ? 'OK: el arreglo hace exactamente lo que debe.' : 'FALLA LA PRUEBA.'}`)
  process.exitCode = ok ? 0 : 1
} finally {
  await client.query(candadoOriginal)   // la BD queda como estaba
  client.release()
  await pool.end()
}
