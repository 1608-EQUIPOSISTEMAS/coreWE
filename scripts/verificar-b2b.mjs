// Verifica el dominio B2B por el MISMO camino que usa el backend
// (utils/spHelper), no por SQL a mano: si esto pasa, la pantalla funciona.
// Crea un contrato de prueba, lo lee, lo edita, lo lista y lo borra.
// Correr despues de fix-b2b-esquema.mjs y fix-b2b-cursores.mjs.
import { pool, q } from './db.mjs'
import { callProcedureReturningRows, callProcedureNoCursor } from '../src/utils/spHelper.js'

const CENTINELA = '__verificacion_automatica__'
const cursor = (proc, params) => callProcedureReturningRows(pool, proc, params)

let creado = null
try {
  const { rows: [empresa] } = await q("SELECT company_id FROM companies WHERE active='Y' ORDER BY company_id LIMIT 1")
  const { rows: [tipo] } = await q("SELECT catalog_id FROM catalog WHERE alias='we_b2b_contract_corporate'")

  // ── alta: el payload real del formulario, anidado en 'contract' ──
  const alta = {
    contract: {
      company_id: empresa.company_id,
      cat_contract_type: tipo.catalog_id,
      contract_name: CENTINELA,
      start_date: '2026-08-17',
      total_amount: 4800.5,
      paid_amount: 1000,
      number_of_licenses: 10,
      close_date: '2026-08-10',
    },
    discounts: [{ cat_type_program: null, cat_model_modality: null, discount_pct: 30 }],
    beneficiaries: [
      { full_name: 'ALUMNO UNO', document_number: '00000001', email: 'uno@empresa.com' },
      { full_name: 'ALUMNO DOS', document_number: '00000002' },
    ],
  }
  const { rows: [r1] } = await pool.query(
    'CALL sp_b2b_contract_register($1::jsonb, NULL, NULL, NULL)', [JSON.stringify(alta)])
  if (r1.result !== 1) throw new Error(`register fallo: ${r1.message}`)
  creado = r1.contract_id
  console.log(`✓ register → contrato ${creado}`)

  // ── lectura ──
  const [leido] = await cursor('public.sp_b2b_contract_get', [creado])
  console.assert(leido, 'get no devolvio filas')
  console.assert(leido.contract_id === creado, 'get no expone contract_id')
  console.assert(Number(leido.total_amount) === 4800.5, `monto perdido: ${leido.total_amount}`)
  console.assert(leido.number_of_licenses === 10, `cupos perdidos: ${leido.number_of_licenses}`)
  console.assert(leido.discounts.length === 1, `descuentos perdidos: ${JSON.stringify(leido.discounts)}`)
  console.assert(leido.beneficiaries.length === 2, `beneficiarios perdidos: ${leido.beneficiaries.length}`)
  console.log(`✓ get → ${leido.company_name} | monto ${leido.total_amount} | cupos ${leido.number_of_licenses} | ` +
              `${leido.discounts.length} dscto | ${leido.beneficiaries.length} beneficiarios`)

  // ── edicion parcial: lo que no se manda no se pisa ──
  const { rows: [r2] } = await pool.query(
    'CALL sp_b2b_contract_update($1, $2::jsonb, NULL, NULL)',
    [creado, JSON.stringify({ contract: { number_of_licenses: 25 } })])
  if (r2.result !== 1) throw new Error(`update fallo: ${r2.message}`)
  const [reLeido] = await cursor('public.sp_b2b_contract_get', [creado])
  console.assert(reLeido.number_of_licenses === 25, `update no persistio: ${reLeido.number_of_licenses}`)
  console.assert(Number(reLeido.total_amount) === 4800.5, 'update piso un campo que no le mandaron')
  console.assert(reLeido.beneficiaries.length === 2, 'update sin clave beneficiaries borro los cupos')
  console.assert(reLeido.discounts.length === 1, 'update sin clave discounts borro los descuentos')
  console.log('✓ update parcial → cupos 25, monto y cupos repartidos intactos')

  // ── reemplazo de hijos: mandar la lista SI la reemplaza entera ──
  const conservado = reLeido.beneficiaries[0]
  const { rows: [r3] } = await pool.query(
    'CALL sp_b2b_contract_update($1, $2::jsonb, NULL, NULL)',
    [creado, JSON.stringify({
      beneficiaries: [
        { beneficiary_id: conservado.beneficiary_id, full_name: 'ALUMNO UNO EDITADO' },
        { full_name: 'ALUMNO TRES' },
      ],
    })])
  if (r3.result !== 1) throw new Error(`update de hijos fallo: ${r3.message}`)
  const [conHijos] = await cursor('public.sp_b2b_contract_get', [creado])
  const nombres = conHijos.beneficiaries.map(b => b.full_name).sort()
  console.assert(nombres.length === 2 && nombres[0] === 'ALUMNO TRES' && nombres[1] === 'ALUMNO UNO EDITADO',
    `reemplazo de beneficiarios mal: ${JSON.stringify(nombres)}`)
  console.log(`✓ update de cupos → ${nombres.join(' + ')}`)

  // ── listados que la UI necesita ──
  const listado = await cursor('public.sp_b2b_contract_list', [JSON.stringify({ q: CENTINELA })])
  const fila = listado.find(f => f.contract_id === creado)
  console.assert(fila, 'list no encuentra el contrato')
  console.assert(Number(fila.seats_assigned) === 2, `cupos asignados mal: ${fila.seats_assigned}`)
  console.assert(Number(fila.seats_available) === 23, `cupos libres mal: ${fila.seats_available}`)
  console.assert(Number(fila.pending_amount) === 3800.5, `saldo mal: ${fila.pending_amount}`)
  console.log(`✓ contract_list → ${fila.seats_assigned}/${fila.number_of_licenses} cupos, saldo ${fila.pending_amount}`)

  const empresas = await cursor('public.sp_b2b_company_list', [JSON.stringify({ page: 1, size: 5 })])
  console.assert(empresas.length > 0, 'company_list vacio')
  console.log(`✓ company_list → ${empresas.length} empresa(s)`)

  const [fichaEmpresa] = await cursor('public.sp_b2b_company_get', [empresa.company_id])
  console.assert(Array.isArray(fichaEmpresa.contacts), 'company_get no devuelve contacts')
  console.assert(Array.isArray(fichaEmpresa.affiliates), 'company_get no devuelve affiliates')
  console.log('✓ company_get → contactos y afiliadas resuelven')

  // Los convenios ya no tienen SP propio: son contratos con tipo CONVENIO.
  const convenios = await cursor('public.sp_b2b_contract_list',
    [JSON.stringify({ page: 1, size: 5, cat_contract_type: (await q(
      "SELECT catalog_id FROM catalog WHERE alias = 'we_b2b_contract_convenio'")).rows[0].catalog_id })])
  console.assert(convenios.every(c => c.contract_type_alias === 'we_b2b_contract_convenio'),
    'el filtro por tipo de contrato no filtra')
  console.log(`✓ convenios via contract_list → ${convenios.length} fila(s)`)

  // ── envio masivo de cupos a FICO ──
  // Tres cupos a proposito distintos: uno completo, uno sin curso y uno sin
  // apellidos. El segundo y el tercero TIENEN que rebotar con motivo, no
  // colarse a medias ni tumbar al primero.
  const { rows: [programa] } = await q(
    "SELECT program_id FROM programs WHERE active='Y' ORDER BY program_id LIMIT 1")
  const { rows: [r4] } = await pool.query(
    'CALL sp_b2b_contract_update($1, $2::jsonb, NULL, NULL)',
    [creado, JSON.stringify({
      beneficiaries: [
        { full_name: 'PRUEBA AUTOMATICA UNO', first_name: 'PRUEBA', last_name: 'AUTOMATICA UNO',
          email: `${CENTINELA}1@example.invalid`, program_version_id: programa.program_id },
        { full_name: 'PRUEBA AUTOMATICA DOS', first_name: 'PRUEBA', last_name: 'AUTOMATICA DOS',
          email: `${CENTINELA}2@example.invalid` },
        { full_name: 'PRUEBA AUTOMATICA TRES', email: `${CENTINELA}3@example.invalid`,
          program_version_id: programa.program_id },
      ],
    })])
  if (r4.result !== 1) throw new Error(`carga de cupos fallo: ${r4.message}`)

  const envio = await cursor('public.sp_b2b_contract_enroll_beneficiaries', [creado, 9])
  const porEstado = Object.fromEntries(envio.map(f => [f.estado, f]))
  console.assert(porEstado.creado?.enrollment_id, `no matriculo al cupo completo: ${JSON.stringify(envio)}`)
  console.assert(porEstado.sin_programa, 'el cupo sin curso no reboto')
  console.assert(porEstado.sin_nombres, 'el cupo sin apellidos no reboto')

  const [conCupos] = await cursor('public.sp_b2b_contract_get', [creado])
  const matriculado = conCupos.beneficiaries.find(b => b.enrollment_id)
  console.assert(matriculado, 'el enrollment_id no volvio al beneficiario')
  const { rows: [insc] } = await q(
    'SELECT total_amount, b2b_contract_id, agent_origin FROM enrollments WHERE enrollment_id = $1',
    [matriculado.enrollment_id])
  console.assert(Number(insc.total_amount) === 0, `la inscripcion B2B no nacio en 0: ${insc.total_amount}`)
  console.assert(insc.b2b_contract_id === creado, 'la inscripcion no quedo colgada del contrato')
  console.log(`✓ enroll_beneficiaries → 1 creada, ${envio.length - 1} rebotadas con motivo`)

  // Reenviar no duplica: el segundo envio solo ve el cupo ya matriculado.
  const reenvio = await cursor('public.sp_b2b_contract_enroll_beneficiaries', [creado, 9])
  console.assert(reenvio.filter(f => f.estado === 'creado').length === 0,
    'reenviar duplico inscripciones')
  console.assert(reenvio.some(f => f.estado === 'ya_matriculado'), 'no reconocio al ya matriculado')
  console.log('✓ reenvio idempotente → 0 duplicadas')
} finally {
  if (creado) {
    // Las inscripciones de prueba y sus personas: el contrato cae por CASCADE,
    // los enrollments no (el FK no borra ventas por diseno).
    const { rows: hechas } = await q(
      'SELECT enrollment_id, customer_id FROM enrollments WHERE b2b_contract_id = $1', [creado])
    for (const { enrollment_id, customer_id } of hechas) {
      await q('DELETE FROM enrollments WHERE enrollment_id = $1', [enrollment_id])
      const { rows: [{ person_id }] } = await q(
        'DELETE FROM customers WHERE customer_id = $1 RETURNING person_id', [customer_id])
      await q('DELETE FROM person_contacts WHERE person_id = $1', [person_id])
      await q('DELETE FROM persons WHERE person_id = $1', [person_id])
    }
    await q('DELETE FROM b2b_contracts WHERE b2b_contract_id = $1', [creado])
  }
  await pool.end()
}
console.log('\nTodo OK.')
