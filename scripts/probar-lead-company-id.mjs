// Prueba end-to-end del parche en la BD LOCAL: registra un lead con empresa,
// verifica que se guarde, lo edita para desvincularla y comprueba el get.
// Deja la BD como la encontro (borra el lead de prueba al final).
import pg from 'pg'

const pool = new pg.Pool({
  connectionString: 'postgresql://postgres:postgres@127.0.0.1:5433/system_erp_dev',
  max: 2, connectionTimeoutMillis: 10000
})

const sp = async (cliente, nombre, params) => {
  const marcas = params.map((_, i) => `$${i + 1}`).join(', ')
  await cliente.query(`CALL ${nombre}(${marcas}, NULL)`, params)
  const { rows } = await cliente.query(`FETCH ALL FROM "cur_${nombre.replace('public.', '')}"`)
  return rows
}

const cliente = await pool.connect()
let leadId = null
try {
  const { rows: [empresa] } = await cliente.query(
    `SELECT company_id, razon_social FROM public.companies ORDER BY company_id LIMIT 1`)
  console.log('empresa de prueba:', empresa)

  await cliente.query('BEGIN')
  const registro = await sp(cliente, 'public.sp_comercial_lead_register', [
    JSON.stringify({ first_name: 'PRUEBA', last_name: 'COMPANY', document_number: '99000099' }),
    JSON.stringify({
      // Minimo que exigen los NOT NULL de leads; los ids salen del catalogo
      // real (WEB / WhatsApp / lead nuevo / interes medio / Peru).
      origin_phone: '900000099', cat_channel: 2590, cat_medium_contact: 2582,
      cat_status_lead: 2366, cat_interest_level: 2369, cat_code_country: 2329,
      cat_frecuency_word: 2597, cat_program_type: 2503, cat_program_modality: 2624,
      program_version_id: 49, b2b: 'Y', bot: 'N', web: 'N',
      message_init_conversation: 'prueba company_id', observations: 'prueba',
      full_name: 'PRUEBA COMPANY', cat_client_type: 3044,
      company_id: empresa.company_id
    }),
    JSON.stringify([]),
    2
  ])
  console.log('register ->', registro[0]?.result, registro[0]?.message)
  leadId = registro[0]?.response?.lead_id ?? registro[0]?.lead_id

  const { rows: [guardado] } = await cliente.query(
    `SELECT lead_id, company_id FROM public.leads WHERE lead_id = $1`, [leadId])
  console.log('guardado ->', guardado)
  console.log(guardado?.company_id === empresa.company_id ? 'OK register guarda la empresa' : 'FALLA register')

  const leido = await sp(cliente, 'public.sp_comercial_lead_get', [leadId])
  console.log('get ->', { company_id: leido[0]?.company_id, company_name: leido[0]?.company_name })

  await sp(cliente, 'public.sp_comercial_lead_update', [
    leadId, JSON.stringify({ company_id: null }), 2, JSON.stringify([])
  ])
  const { rows: [desvinculado] } = await cliente.query(
    `SELECT company_id FROM public.leads WHERE lead_id = $1`, [leadId])
  console.log(desvinculado?.company_id === null ? 'OK update desvincula la empresa' : 'FALLA update: ' + desvinculado?.company_id)
} finally {
  // Todo corrio dentro de una transaccion: no queda nada en la BD de pruebas.
  await cliente.query('ROLLBACK')
  cliente.release()
  await pool.end()
}
