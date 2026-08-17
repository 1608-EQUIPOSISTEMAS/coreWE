// Pasa los SPs de B2B de "OUT p_result refcursor" a "INOUT p_result refcursor".
//
// Por que: utils/spHelper.callProcedureReturningRows (el unico camino que usan
// los repositorios) inventa un nombre de cursor, lo pasa como ultimo argumento y
// despues hace FETCH ALL FROM <ese nombre>. Con OUT, Postgres ignora el valor de
// entrada y abre un "<unnamed portal N>": el FETCH revienta con
// 'cursor "cur_..." does not exist'. Por eso Empresas, Contratos y Convenios
// estaban muertos aunque los SPs "existieran".
//
// CREATE OR REPLACE no puede cambiar el modo de un parametro, asi que hay que
// DROP + CREATE. Va todo en una transaccion: o migran los seis, o ninguno.
import { pool } from './db.mjs'

const OBJETIVOS = [
  ['sp_b2b_company_get', 'IN p_company_id integer, OUT p_result refcursor'],
  ['sp_b2b_company_list', 'IN p_filters jsonb, OUT p_result refcursor'],
  ['sp_b2b_contract_get', 'IN p_contract_id integer, OUT p_result refcursor'],
  ['sp_b2b_contract_list', 'IN p_filters jsonb, OUT p_result refcursor'],
  ['sp_b2b_agreement_get', 'IN p_agreement_id integer, OUT p_result refcursor'],
  ['sp_b2b_agreement_list', 'IN p_filters jsonb, OUT p_result refcursor'],
]

const cliente = await pool.connect()
try {
  await cliente.query('BEGIN')
  for (const [nombre, firma] of OBJETIVOS) {
    const { rows } = await cliente.query(
      `SELECT pg_get_functiondef(p.oid) AS src
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = $1
          AND pg_get_function_identity_arguments(p.oid) = $2`, [nombre, firma])

    if (!rows.length) { console.log(`— ${nombre}: ya migrado o no existe con esa firma`); continue }

    const migrado = rows[0].src.replace('OUT p_result refcursor', 'INOUT p_result refcursor')
    if (migrado === rows[0].src) throw new Error(`${nombre}: no encontre el parametro OUT en la definicion`)

    await cliente.query(`DROP PROCEDURE public.${nombre}(${firma})`)
    await cliente.query(migrado)
    console.log(`✓ ${nombre} → INOUT`)
  }
  await cliente.query('COMMIT')
} catch (e) {
  await cliente.query('ROLLBACK')
  throw e
} finally {
  cliente.release()
  await pool.end()
}
