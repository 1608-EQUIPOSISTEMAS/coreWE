// Check del alta/edicion de empresas B2B: manda el payload EXACTO que arma
// views/b2b/companies/Form.vue y verifica que la fila quede completa y visible.
// Falla si alguien vuelve a desalinear el contrato front <-> SP: los SPs leian
// p_data->>'razon_social' en la raiz mientras el front manda { company: {...} },
// y como en jsonb una clave ausente es NULL, cada alta creaba una empresa vacia
// sin dar error. Absorbe al viejo check-b2b-company-sector.mjs.
// Corre contra la BD de pruebas y revierte: no deja la empresa de prueba.
import assert from 'node:assert/strict'
import { pool } from './db.mjs'

const SECTOR_LOGISTICA = 5042
const CLASIFICACION_MEDIANA = 5053

const payloadDelFormulario = {
  company: {
    razon_social: 'QROMA CHECK',
    razon_comercial: 'QROMA',
    document_number: '20000000001',
    is_intermediary: 'N',
    cat_sector: SECTOR_LOGISTICA,
    cat_classification: CLASIFICACION_MEDIANA
  },
  contacts: [{
    contact_name: 'Contacto Uno',
    contact_position: 'Compras',
    contact_phone: '999888777',
    contact_email: 'uno@qroma.pe',
    is_primary: 'Y'
  }],
  affiliate_ids: []
}

const call = (client, sp, args) =>
  client.query(`CALL public.${sp}`, args).then(r => r.rows[0])

const client = await pool.connect()
try {
  await client.query('BEGIN')

  const alta = await call(client, 'sp_b2b_company_register($1::jsonb, NULL, NULL, NULL)',
    [JSON.stringify(payloadDelFormulario)])
  assert.equal(alta.result, 1, `el alta fue rechazada: ${alta.message}`)

  const { rows: [fila] } = await client.query(
    `SELECT razon_social, razon_comercial, document_number, active, registration_date
       FROM public.companies WHERE company_id = $1`, [alta.company_id])
  assert.equal(fila.razon_social, 'QROMA CHECK', 'la razon social llego NULL al INSERT')
  assert.equal(fila.razon_comercial, 'QROMA', 'razon_comercial se perdio')
  assert.equal(fila.document_number, '20000000001', 'el RUC se perdio')
  assert.equal(fila.active, 'Y')
  assert.ok(fila.registration_date, 'el alta quedo sin fecha de registro')

  const { rows: [{ n: contactos }] } = await client.query(
    `SELECT COUNT(*)::int AS n FROM public.company_contacts
      WHERE company_id = $1 AND active = 'Y'`, [alta.company_id])
  assert.equal(contactos, 1, 'el contacto principal no se guardo')

  // La empresa recien creada tiene que ser encontrable por el buscador, que es
  // lo que fallaba de cara al usuario.
  await client.query("CALL public.sp_b2b_company_list($1::jsonb, 'cur_chk')",
    [JSON.stringify({ search: 'QROMA CHECK', size: 20 })])
  const { rows: encontradas } = await client.query('FETCH ALL FROM cur_chk')
  assert.equal(encontradas.length, 1, 'la empresa no aparece en el buscador del modulo')
  const [vista] = encontradas
  assert.equal(vista.commercial_name, 'QROMA', 'nombre comercial perdido en el viaje')
  assert.equal(Number(vista.cat_sector), SECTOR_LOGISTICA, 'sector perdido en el viaje')
  assert.equal(Number(vista.cat_classification), CLASIFICACION_MEDIANA, 'clasificacion perdida en el viaje')

  const edicion = await call(client, 'sp_b2b_company_update($1, $2::jsonb, NULL, NULL)',
    [alta.company_id, JSON.stringify({
      company: { razon_social: 'QROMA CHECK EDITADA' }, contacts: [], affiliate_ids: []
    })])
  assert.equal(edicion.result, 1, `la edicion fue rechazada: ${edicion.message}`)
  const { rows: [editada] } = await client.query(
    'SELECT razon_social, document_number FROM public.companies WHERE company_id = $1',
    [alta.company_id])
  assert.equal(editada.razon_social, 'QROMA CHECK EDITADA')
  assert.equal(editada.document_number, '20000000001', 'la edicion borro el RUC que no venia en el payload')

  const vacia = await call(client, 'sp_b2b_company_register($1::jsonb, NULL, NULL, NULL)',
    [JSON.stringify({ company: { razon_social: '  ', document_number: '20999999999' }, contacts: [], affiliate_ids: [] })])
  assert.equal(vacia.result, 0, 'se acepto un alta sin razon social')
  assert.equal(vacia.company_id, null, 'se creo la fila fantasma igual')

  const sinRuc = await call(client, 'sp_b2b_company_register($1::jsonb, NULL, NULL, NULL)',
    [JSON.stringify({ company: { razon_social: 'SIN RUC SAC' }, contacts: [], affiliate_ids: [] })])
  assert.equal(sinRuc.result, 0, 'se acepto un alta sin RUC')

  // El mismo RUC con guiones y espacios sigue siendo el mismo RUC.
  const duplicada = await call(client, 'sp_b2b_company_register($1::jsonb, NULL, NULL, NULL)',
    [JSON.stringify({
      company: { razon_social: 'QROMA CLON', document_number: ' 20-000000001 ' },
      contacts: [], affiliate_ids: []
    })])
  assert.equal(duplicada.result, 0, 'se acepto un RUC duplicado')
  assert.match(duplicada.message, /20000000001/, 'el rechazo no dice cual es el RUC repetido')

  // Editar una empresa sin tocarle el RUC no puede chocar consigo misma.
  const reedicion = await call(client, 'sp_b2b_company_update($1, $2::jsonb, NULL, NULL)',
    [alta.company_id, JSON.stringify({
      company: { razon_social: 'QROMA CHECK EDITADA', document_number: '20000000001' },
      contacts: [], affiliate_ids: []
    })])
  assert.equal(reedicion.result, 1, `la empresa choco con su propio RUC: ${reedicion.message}`)

  await client.query('ROLLBACK')
  console.log('OK: alta completa con sector y clasificacion, busqueda, edicion, y rechazo de razon social vacia / sin RUC / RUC duplicado')
} catch (err) {
  await client.query('ROLLBACK')
  console.error('FALLO:', err.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
