// Ejercita los endpoints B2B por HTTP contra la BD de pruebas.
//
// verificar-b2b.mjs prueba los SPs directamente y pasaba en verde mientras la
// pantalla devolvia "Route not found" y "no existe el procedimiento": el bug no
// estaba en el SP sino en el cableado (rutas sin registrar, firmas mal armadas).
// Esto recorre el mismo camino que el navegador: ruta -> schema -> controller ->
// usecase -> repositorio -> SP.
//
// Corre contra lo que diga Backend/.env, que debe apuntar a system_erp_dev.
import 'dotenv/config'
import { buildApp } from '../src/buildApp.js'

const app = await buildApp({ logger: false })
await app.ready()

const token = app.jwt.sign({ id: 9, username: 'verificador', roles: ['ADMIN'] })
const post = async (url, payload) => {
  const res = await app.inject({
    method: 'POST', url, payload, headers: { authorization: `Bearer ${token}` }
  })
  if (res.statusCode !== 200) throw new Error(`${url} -> ${res.statusCode}: ${res.body.slice(0, 300)}`)
  return res.json()
}

const RUC = '99999999999'   // fuera del rango real: 11 digitos que empiezan en 9
let companyId = null
let contractId = null

try {
  // ── empresa: alta, lectura, edicion ──
  const alta = await post('/api/b2b/companyregister', {
    company: { razon_social: 'VERIFICACION AUTOMATICA SAC', document_number: RUC, is_intermediary: 'N' },
    contacts: [{ contact_name: 'CONTACTO UNO', contact_email: 'uno@verificacion.invalid', is_primary: 'Y' }],
    affiliate_ids: [],
  })
  if (alta.result !== 1) throw new Error(`companyregister: ${alta.message}`)
  companyId = alta.company_id
  console.log(`✓ companyregister → empresa ${companyId}`)

  const ficha = await post('/api/b2b/companyget', { id: companyId })
  console.assert(ficha.data?.company_id === companyId, `companyget no devolvio la empresa: ${JSON.stringify(ficha.data)}`)
  console.assert(ficha.data.contacts?.length === 1, `contactos perdidos: ${JSON.stringify(ficha.data.contacts)}`)
  console.log(`✓ companyget → ${ficha.data.razon_social} | ${ficha.data.contacts.length} contacto(s)`)

  const edicion = await post('/api/b2b/companyupdate', {
    id: companyId,
    company: { razon_social: 'VERIFICACION AUTOMATICA EDITADA SAC', document_number: RUC, is_intermediary: 'N' },
    contacts: ficha.data.contacts.map(c => ({ ...c, contact_position: 'GERENTE' })),
    affiliate_ids: [],
  })
  if (edicion.result !== 1) throw new Error(`companyupdate: ${edicion.message}`)
  const reLeida = await post('/api/b2b/companyget', { id: companyId })
  console.assert(reLeida.data.razon_social.includes('EDITADA'), 'companyupdate no persistio')
  console.log('✓ companyupdate → razon social actualizada')

  const listado = await post('/api/b2b/companylist', { page: 1, size: 5 })
  console.assert(Array.isArray(listado.data) && listado.data.length > 0, 'companylist vacio')
  console.log(`✓ companylist → ${listado.data.length} fila(s)`)

  const combo = await post('/api/b2b/companycaller', { q: 'VERIFICACION' })
  console.assert(combo.data.some(c => c.company_id === companyId), 'companycaller no encuentra la empresa nueva')
  console.log('✓ companycaller → el selector "Empresa vinculada" resuelve')

  // ── contrato: alta, lectura, edicion parcial ──
  // El tipo se lee de la BD y no por HTTP: aqui se prueba B2B, no el catalogo.
  const { pool: db } = await import('../src/shared/db/pool.js')
  const { rows: [tipo] } = await db.query(
    "SELECT catalog_id FROM catalog WHERE alias = 'we_b2b_contract_corporate'")

  const altaContrato = await post('/api/b2b/contractregister', {
    contract: {
      company_id: companyId,
      cat_contract_type: tipo.catalog_id,
      contract_name: 'VERIFICACION AUTOMATICA',
      start_date: '2026-08-17',
      total_amount: 1000,
      number_of_licenses: 3,
    },
    beneficiaries: [{ full_name: 'ALUMNO PRUEBA', first_name: 'ALUMNO', last_name: 'PRUEBA' }],
  })
  if (altaContrato.result !== 1) throw new Error(`contractregister: ${altaContrato.message}`)
  contractId = altaContrato.contract_id
  console.log(`✓ contractregister → contrato ${contractId}`)

  const fichaContrato = await post('/api/b2b/contractget', { id: contractId })
  console.assert(fichaContrato.data?.contract_id === contractId, 'contractget no devolvio el contrato')
  console.assert(fichaContrato.data.beneficiaries?.length === 1, 'beneficiarios perdidos')
  console.log(`✓ contractget → ${fichaContrato.data.beneficiaries.length} beneficiario(s)`)

  const edicionContrato = await post('/api/b2b/contractupdate', {
    id: contractId, contract: { number_of_licenses: 7 },
  })
  if (edicionContrato.result !== 1) throw new Error(`contractupdate: ${edicionContrato.message}`)
  const reLeidoContrato = await post('/api/b2b/contractget', { id: contractId })
  console.assert(reLeidoContrato.data.number_of_licenses === 7, 'contractupdate no persistio')
  console.assert(reLeidoContrato.data.beneficiaries.length === 1, 'contractupdate borro los cupos')
  console.log('✓ contractupdate → cupos 7, beneficiarios intactos')

  const envio = await post('/api/b2b/contractenroll', { contract_id: contractId })
  console.assert(envio.rejected === 1 && envio.enrolled === 0,
    `el cupo sin curso debia rebotar: ${JSON.stringify(envio)}`)
  console.log(`✓ contractenroll → ${envio.rejected} rebotado con motivo "${envio.detail[0].estado}"`)

  const listadoContratos = await post('/api/b2b/contractlist', { q: 'VERIFICACION AUTOMATICA' })
  console.assert(listadoContratos.data.some(c => c.contract_id === contractId), 'contractlist no lo encuentra')
  console.log(`✓ contractlist → ${listadoContratos.data.length} fila(s)`)
} finally {
  const { pool } = await import('../src/shared/db/pool.js')
  if (contractId) await pool.query('DELETE FROM b2b_contracts WHERE b2b_contract_id = $1', [contractId])
  if (companyId) await pool.query('DELETE FROM companies WHERE company_id = $1', [companyId])
  await app.close()
}
console.log('\nTodo OK por HTTP.')
// buildApp deja vivos el cron de redes y el listener de NOTIFY: sin esto el
// proceso queda colgado aunque la verificacion haya terminado bien.
process.exit(0)
