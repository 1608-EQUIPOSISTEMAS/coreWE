// Verifica que sector, clasificacion y nombre comercial sobrevivan el viaje
// completo formulario -> SP de guardado -> SP de listado.
//
// Existe porque las tres columnas ya estaban en `companies` y en los tres SPs,
// pero el formulario nunca las pedia: 398 empresas activas, 0 clasificadas.
// Si alguien vuelve a soltar el dato en el camino, esto falla.
//
// Corre contra la BD de pruebas y hace ROLLBACK: no deja la empresa de prueba.
import { pool } from './db.mjs'

const SECTOR_LOGISTICA = 5042
const CLASIFICACION_MEDIANA = 5053
const DOCUMENTO = '20000000001'

const empresa = {
  company: {
    razon_social: 'EMPRESA DE PRUEBA CHECK S.A.C.',
    razon_comercial: 'Prueba Check',
    document_number: DOCUMENTO,
    is_intermediary: 'N',
    cat_sector: SECTOR_LOGISTICA,
    cat_classification: CLASIFICACION_MEDIANA,
  },
  contacts: [],
  affiliate_ids: [],
}

function assert (condicion, mensaje) {
  if (!condicion) throw new Error(`FALLO: ${mensaje}`)
}

const cliente = await pool.connect()
try {
  await cliente.query('BEGIN')

  const alta = await cliente.query(
    'CALL public.sp_b2b_company_register($1::jsonb, NULL, NULL, NULL)',
    [JSON.stringify(empresa)]
  )
  assert(alta.rows[0].result === 1, `el registro devolvio "${alta.rows[0].message}"`)

  await cliente.query(
    "CALL public.sp_b2b_company_list($1::jsonb, 'cur_check')",
    [JSON.stringify({ q: DOCUMENTO, page: 1, size: 10 })]
  )
  const { rows } = await cliente.query('FETCH ALL FROM cur_check')

  assert(rows.length === 1, `el listado devolvio ${rows.length} filas, esperaba 1`)
  const [fila] = rows
  assert(fila.commercial_name === 'Prueba Check', `nombre comercial perdido: ${fila.commercial_name}`)
  assert(Number(fila.cat_sector) === SECTOR_LOGISTICA, `sector perdido: ${fila.cat_sector}`)
  assert(Number(fila.cat_classification) === CLASIFICACION_MEDIANA, `clasificacion perdida: ${fila.cat_classification}`)

  console.log('OK — nombre comercial, sector y clasificacion viajan de ida y vuelta')
} finally {
  await cliente.query('ROLLBACK')
  cliente.release()
  await pool.end()
}
