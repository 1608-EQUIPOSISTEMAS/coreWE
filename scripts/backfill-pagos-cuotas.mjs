// Cobra en la BD lo que la hoja FICO ya da por cobrado: marca las cuotas como
// Pagada, completa el pago de la reserva y registra un `payments` por cuota con su
// medio, cuenta y N de operacion. Complementa a marca-pagos-hoja-fico.mjs, que
// deduce los pagos del INGRESO y no sabe de la fila de detalle (medio y cuenta
// distintos por cuota, que es lo normal cuando cobran a empresas distintas).
//
//   node scripts/backfill-pagos-cuotas.mjs <caso.json>           (dry-run)
//   node scripts/backfill-pagos-cuotas.mjs <caso.json> --apply
//
// El <caso.json> describe UNA inscripcion (ver ejemplo en el README de scripts).
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pool } from './db.mjs'

const CUOTA_PAGADA = 4454 // we_inst_paid: unico estado que el matview suma en PAID_AMOUNT
const PLAN_CONTADO = 2466 // we_payment_way_single: el plan de todo hijo SEG
const TIPO_INICIAL = 3113 // we_payment_type_initial
const TIPO_CUOTA = 3114 // we_payment_type_installment
const LIQUIDACION_PENDIENTE = 2573
const USER_ID = 9 // ADMIN: la correccion no la hizo el asesor

const rutaCaso = process.argv[2]
const APLICAR = process.argv.includes('--apply')
if (!rutaCaso) {
  console.error('Uso: node scripts/backfill-pagos-cuotas.mjs <caso.json> [--apply]')
  process.exit(1)
}
const caso = JSON.parse(readFileSync(resolve(rutaCaso), 'utf8'))
const EID = Number(caso.enrollment_id)
const TOTAL_HOJA = Number(caso.total_hoja)
const CUOTAS = [caso.reserva, ...caso.cuotas]

// El tunel SSH se cae seguido: toda la operacion corre en UNA conexion y se
// reintenta entera. Cada paso es idempotente, asi que repetirla es seguro.
const conReintento = async (tarea) => {
  for (let intento = 1; ; intento++) {
    const client = await pool.connect().catch((err) => err)
    if (client instanceof Error) {
      if (intento >= 40) throw client
      await new Promise((r) => setTimeout(r, 5000))
      continue
    }
    try {
      return await tarea(client)
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      const tunelCaido = /ECONNREFUSED|ETIMEDOUT|ECONNRESET|terminating connection/i.test(err.message)
      if (!tunelCaido || intento >= 40) throw err
      console.error(`[tunel] ${err.message} - reintento ${intento}`)
      await new Promise((r) => setTimeout(r, 5000))
    } finally {
      client.release()
    }
  }
}

const leerEstado = async (client) => ({
  cabecera: (await client.query(
    `SELECT enrollment_id, total_amount, list_price, discount_amount, cat_type_status,
            cat_payment_plan, cat_fico_status, notes
       FROM enrollments WHERE enrollment_id = $1`, [EID]
  )).rows[0],
  cuotas: (await client.query(
    `SELECT installment_id, installment_number, amount, due_date, cat_status
       FROM payment_installments WHERE enrollment_id = $1 ORDER BY installment_number`, [EID]
  )).rows,
  pagos: (await client.query(
    `SELECT payment_id, installment_id, amount, payment_date, transaction_code,
            cat_method_payment, cat_payment_type, cat_settlement_status,
            settled_in_account_id, active
       FROM payments WHERE enrollment_id = $1 ORDER BY payment_id`, [EID]
  )).rows,
  hijos: (await client.query(
    `SELECT enrollment_id, cat_type_status, cat_payment_plan, total_amount
       FROM enrollments WHERE parent_enrollment_id = $1 ORDER BY enrollment_id`, [EID]
  )).rows
})

const cuotaPorNumero = (cuotas, numero) => {
  const fila = cuotas.find((c) => Number(c.installment_number) === numero)
  if (!fila) throw new Error(`Falta la cuota ${numero} en el cronograma de ${EID}`)
  return fila
}

// La hoja manda sobre el estado, nunca sobre los montos: si un monto no coincide
// es que la fila no es la de esta inscripcion y hay que parar antes de escribir.
const verificarMontos = (cuotas) => {
  for (const esperada of CUOTAS) {
    const fila = cuotaPorNumero(cuotas, esperada.numero)
    if (Number(fila.amount) !== Number(esperada.monto)) {
      throw new Error(`Cuota ${esperada.numero}: BD ${fila.amount} != hoja ${esperada.monto}`)
    }
  }
  const suma = cuotas.reduce((acc, c) => acc + Number(c.amount), 0)
  if (Math.abs(suma - TOTAL_HOJA) > 0.01) throw new Error(`sum(cuotas)=${suma} != total hoja ${TOTAL_HOJA}`)
}

const resultado = await conReintento(async (client) => {
  const antes = await leerEstado(client)
  if (!antes.cabecera) throw new Error(`No existe el enrollment ${EID}`)
  verificarMontos(antes.cuotas)
  if (Math.abs(Number(antes.cabecera.total_amount) - TOTAL_HOJA) > 0.01) {
    throw new Error(`total_amount ${antes.cabecera.total_amount} != total hoja ${TOTAL_HOJA}`)
  }

  console.log('--- ANTES ---')
  console.table(antes.cuotas)
  console.table(antes.pagos)
  console.table(antes.hijos)

  if (!APLICAR) return { dry: true }

  writeFileSync(new URL(`./_backup_${EID}_${caso.fecha_caso}.json`, import.meta.url), JSON.stringify(antes, null, 2))

  await client.query('BEGIN')

  const cuotasPagadas = await client.query(
    `UPDATE payment_installments SET cat_status = $2
      WHERE enrollment_id = $1 AND cat_status <> $2`, [EID, CUOTA_PAGADA]
  )

  // Varios imports sellaron la cuota 0 con la fecha de importacion en vez de la
  // fecha en que se cobro la reserva. El vencimiento de las demas cuotas no se
  // toca: ahi el cronograma es el que vale, no la fecha de cobro.
  const reservaReprogramada = await client.query(
    `UPDATE payment_installments SET due_date = $3
      WHERE enrollment_id = $1 AND installment_number = $2 AND due_date <> $3::date`,
    [EID, caso.reserva.numero, caso.reserva.fecha]
  )

  // La reserva ya tiene su `payments` (lo crea el alta), pero llega sin medio
  // canonico, sin cuenta y sin operacion: se completa, no se duplica.
  const reserva = caso.reserva
  const reservaCompletada = await client.query(
    `UPDATE payments
        SET cat_method_payment = $3, cat_payment_type = $4, cat_settlement_status = $5,
            settled_in_account_id = $6, transaction_code = $7
      WHERE enrollment_id = $1 AND installment_id = $2 AND active = 'Y'`,
    [EID, cuotaPorNumero(antes.cuotas, reserva.numero).installment_id, reserva.medio,
      TIPO_INICIAL, LIQUIDACION_PENDIENTE, reserva.cuenta, reserva.operacion]
  )

  let pagosCreados = 0
  for (const cuota of caso.cuotas) {
    const fila = cuotaPorNumero(antes.cuotas, cuota.numero)
    const { rowCount } = await client.query(
      `INSERT INTO payments (enrollment_id, installment_id, amount, payment_date, transaction_code,
                             cat_method_payment, cat_payment_type, cat_settlement_status,
                             settled_in_account_id, active, user_registration_id)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, 'Y', $10
        WHERE NOT EXISTS (SELECT 1 FROM payments WHERE installment_id = $2 AND active = 'Y')`,
      [EID, fila.installment_id, cuota.monto, cuota.fecha, cuota.operacion,
        cuota.medio, TIPO_CUOTA, LIQUIDACION_PENDIENTE, cuota.cuenta, USER_ID]
    )
    pagosCreados += rowCount
  }

  // Regla invariante: el hijo de paquete no vende nada, va SEG + al contado.
  const hijosCorregidos = await client.query(
    `UPDATE enrollments
        SET cat_payment_plan = $2, user_modification_id = $3, modification_date = NOW()
      WHERE parent_enrollment_id = $1 AND cat_payment_plan <> $2`,
    [EID, PLAN_CONTADO, USER_ID]
  )

  const despues = await leerEstado(client)
  const sumaCuotas = despues.cuotas.reduce((acc, c) => acc + Number(c.amount), 0)
  const sumaPagos = despues.pagos.filter((p) => p.active === 'Y').reduce((acc, p) => acc + Number(p.amount), 0)
  if (Math.abs(sumaCuotas - Number(despues.cabecera.total_amount)) > 0.01) {
    throw new Error(`sanity: sum(cuotas)=${sumaCuotas} != total_amount=${despues.cabecera.total_amount}`)
  }
  if (Math.abs(sumaPagos - TOTAL_HOJA) > 0.01) {
    throw new Error(`sanity: sum(pagos)=${sumaPagos} != INGRESO de la hoja ${TOTAL_HOJA}`)
  }
  if (despues.cuotas.some((c) => Number(c.cat_status) !== CUOTA_PAGADA)) throw new Error('sanity: cuotas fuera de Pagada')
  if (despues.hijos.some((h) => Number(h.cat_payment_plan) !== PLAN_CONTADO)) throw new Error('sanity: hijos fuera de Al contado')

  await client.query(
    `INSERT INTO enrollment_audit_log (enrollment_id, action, performed_by, justificacion, changes)
     SELECT $1, 'import_fix_installments_and_children', $2, $3, $4::jsonb
      WHERE NOT EXISTS (
        SELECT 1 FROM enrollment_audit_log
         WHERE enrollment_id = $1 AND action = 'import_fix_installments_and_children')`,
    [EID, USER_ID, caso.justificacion, JSON.stringify({
      cuotas_a_pagada: cuotasPagadas.rowCount,
      reserva_completada: reservaCompletada.rowCount,
      reserva_reprogramada: reservaReprogramada.rowCount,
      pagos_creados: pagosCreados,
      hijos_a_contado: hijosCorregidos.rowCount,
      total_amount: despues.cabecera.total_amount,
      suma_cuotas: sumaCuotas,
      suma_pagos: sumaPagos
    })]
  )

  await client.query('COMMIT')

  // El panel FICO lee la cabecera y el PAID_AMOUNT de la matview: sin refresh el
  // cambio es invisible en la UI.
  await client.query('REFRESH MATERIALIZED VIEW mv_enrollment_report_system')

  const mv = (await client.query(
    `SELECT "ID", "DNI", "NOMBRES COMPLETOS", "TIP_MEMBER", "ESTADO ALUMNO", "TIPO DE PAGO",
            "DSTC. PRINCIPAL", "DSTC'S ADICIONALES", "PRECIO LISTA", "TOTAL A PAGAR",
            "RESERVA_AMOUNT", "PAID_AMOUNT"
       FROM mv_enrollment_report_system WHERE "ID" = $1`, [EID]
  )).rows

  return {
    despues,
    mv,
    contadores: {
      cuotas_a_pagada: cuotasPagadas.rowCount,
      reserva_completada: reservaCompletada.rowCount,
      reserva_reprogramada: reservaReprogramada.rowCount,
      pagos_creados: pagosCreados,
      hijos_a_contado: hijosCorregidos.rowCount
    }
  }
})

if (resultado.dry) {
  console.log('\n(dry-run: no se escribio nada; agrega --apply)')
} else {
  console.log('\n--- DESPUES ---')
  console.table(resultado.despues.cuotas)
  console.table(resultado.despues.pagos)
  console.table(resultado.despues.hijos)
  console.log('contadores:', resultado.contadores)
  console.log('--- fila del matview ---')
  console.dir(resultado.mv, { depth: null })
}

await pool.end()
process.exit(0)
