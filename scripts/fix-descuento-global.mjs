// Reconstruye el descuento porcentual de una inscripcion importada: el importador
// deja `list_price = total_amount` y `discount_amount = 0`, o sea la venta aparece
// a precio de lista y el panel FICO no muestra ningun DSTC. PRINCIPAL.
//
//   node scripts/fix-descuento-global.mjs <enrollment_id> <porcentaje>           (dry-run)
//   node scripts/fix-descuento-global.mjs <enrollment_id> <porcentaje> --apply
//
// El total NO se toca: es lo cobrado y manda. Se despeja el precio de lista hacia
// atras (list = total / (1 - %)), que es la unica lectura que hace cuadrar el % de
// la hoja con el total. Aborta si ya hay descuentos aplicados: ahi la mezcla de
// porcentaje, promo fija y beneficios es una decision, no una formula.
import { writeFileSync } from 'node:fs'
import { pool } from './db.mjs'

const DESCUENTO_GLOBAL_POR_PORCENTAJE = { 40: 10, 45: 11, 50: 12, 55: 13, 60: 14, 65: 15, 70: 16, 100: 17 }
const USER_ID = 9 // ADMIN: la correccion no la hizo el asesor

const EID = Number(process.argv[2])
const PORCENTAJE = Number(process.argv[3])
const APLICAR = process.argv.includes('--apply')
const discountId = DESCUENTO_GLOBAL_POR_PORCENTAJE[PORCENTAJE]
if (!EID || !discountId) {
  console.error('Uso: node scripts/fix-descuento-global.mjs <enrollment_id> <porcentaje> [--apply]')
  console.error('Porcentajes con descuento global:', Object.keys(DESCUENTO_GLOBAL_POR_PORCENTAJE).join(', '))
  process.exit(1)
}

const redondear2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

// El tunel SSH se cae seguido: una sola conexion, reintentada entera.
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
      if (!/ECONNREFUSED|ETIMEDOUT|ECONNRESET|terminating connection/i.test(err.message) || intento >= 40) throw err
      console.error(`[tunel] ${err.message} - reintento ${intento}`)
      await new Promise((r) => setTimeout(r, 5000))
    } finally {
      client.release()
    }
  }
}

const resultado = await conReintento(async (client) => {
  const antes = (await client.query(
    `SELECT enrollment_id, list_price, discount_amount, total_amount, cat_currency, cat_profile_id,
            program_version_id, notes
       FROM enrollments WHERE enrollment_id = $1`, [EID]
  )).rows[0]
  if (!antes) throw new Error(`No existe el enrollment ${EID}`)

  const yaAplicados = (await client.query(
    `SELECT ed.discount_id, ed.order_applied, ed.calculated_amount, d.description
       FROM enrollment_discounts ed JOIN discounts d ON d.discount_id = ed.discount_id
      WHERE ed.enrollment_id = $1 ORDER BY ed.order_applied`, [EID]
  )).rows
  if (yaAplicados.length) {
    console.table(yaAplicados)
    throw new Error(`El enrollment ${EID} ya tiene descuentos aplicados: revisar a mano, no hay formula`)
  }

  const total = Number(antes.total_amount)
  const listaCalculada = redondear2(total / (1 - PORCENTAJE / 100))
  const descuento = redondear2(listaCalculada - total)
  // Un precio de lista con mas de 2 decimales significa que el % de la hoja no es
  // el que produjo ese total: mejor parar que dejar un numero inventado.
  if (Math.abs(redondear2(listaCalculada * (1 - PORCENTAJE / 100)) - total) > 0.01) {
    throw new Error(`El ${PORCENTAJE}% no reconstruye el total ${total} (daria lista ${listaCalculada})`)
  }

  const precioCatalogo = (await client.query(
    `SELECT list_price FROM program_pricing
      WHERE program_version_id = $1 AND cat_currency_id = $2 AND cat_profile_id = $3 AND active
      LIMIT 1`, [antes.program_version_id, antes.cat_currency, antes.cat_profile_id]
  )).rows[0]

  console.log('ANTES:', antes)
  console.log(`CALCULO: total ${total} / (1 - ${PORCENTAJE}%) => lista ${listaCalculada}, descuento ${descuento}`)
  console.log('PRECIO DE CATALOGO VIGENTE (program_pricing):', precioCatalogo ? precioCatalogo.list_price : 'sin fila')
  if (precioCatalogo && Number(precioCatalogo.list_price) !== listaCalculada) {
    console.log('  ojo: la lista despejada NO es la del catalogo vigente (precios cambian por temporada).')
  }

  if (!APLICAR) return { dry: true }

  writeFileSync(new URL(`./_backup_descuento_${EID}.json`, import.meta.url), JSON.stringify(antes, null, 2))

  await client.query('BEGIN')
  await client.query(
    `UPDATE enrollments
        SET list_price = $2, discount_amount = $3, user_modification_id = $4, modification_date = NOW()
      WHERE enrollment_id = $1`, [EID, listaCalculada, descuento, USER_ID]
  )
  await client.query(
    `INSERT INTO enrollment_discounts (enrollment_id, discount_id, order_applied, calculated_amount, user_registration_id)
     SELECT $1, $2, 1, $3, $4
      WHERE NOT EXISTS (SELECT 1 FROM enrollment_discounts WHERE enrollment_id = $1 AND discount_id = $2)`,
    [EID, discountId, descuento, USER_ID]
  )
  await client.query(
    `INSERT INTO enrollment_audit_log (enrollment_id, action, performed_by, justificacion, changes)
     VALUES ($1, 'discount_amount_corrected', $2, $3, $4::jsonb)`,
    [EID, USER_ID,
      `La importacion masiva dejo la venta a precio de lista (list_price = total_amount, sin fila en ` +
      `enrollment_discounts) pese a que la hoja FICO marca ${PORCENTAJE}%. Se despeja el precio de lista ` +
      `desde el total cobrado y se registra el descuento global. El total no cambia.`,
      JSON.stringify({
        list_price: { old: antes.list_price, new: listaCalculada },
        discount_amount: { old: antes.discount_amount, new: descuento },
        discount_id: discountId,
        total_amount: antes.total_amount
      })]
  )
  await client.query('COMMIT')
  await client.query('REFRESH MATERIALIZED VIEW mv_enrollment_report_system')

  return {
    despues: (await client.query(
      `SELECT "ID", "DSTC. PRINCIPAL", "PRECIO LISTA", "TOTAL A PAGAR", "TOTAL DESCONTADO"
         FROM mv_enrollment_report_system WHERE "ID" = $1`, [EID]
    )).rows
  }
})

if (resultado.dry) console.log('\n(dry-run: no se escribio nada; agrega --apply)')
else console.dir(resultado.despues, { depth: null })

await pool.end()
process.exit(0)
