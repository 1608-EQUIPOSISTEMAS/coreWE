// Siembra el tipo de pago "Detraccion" (payments.cat_payment_type).
//
// Por que existe: cuando una empresa paga una OS/OP aplicando detraccion (SPOT),
// la cuota se salda con DOS depositos —el pago a nuestra cuenta y el 12% a la
// cuenta del Banco de la Nacion—. Cada uno entra como una fila de payments contra
// la misma cuota, y sin este alias la segunda seria indistinguible de la primera.
//
//   node scripts/seed-payment-type-detraction.mjs
//
// Idempotente: si el alias ya existe no lo toca. Nunca borra.
import { q, pool } from './db.mjs'

const ALIAS = 'we_payment_type_detraction'
const PADRE = 'we_payment_type'   // 3112, el mismo del resto de tipos de pago

async function main () {
  const { rows: [existente] } = await q(
    'SELECT catalog_id, description FROM catalog WHERE alias = $1', [ALIAS]
  )
  if (existente) {
    console.log(`[=] ${ALIAS} ya existe: catalog_id=${existente.catalog_id} (${existente.description})`)
    return
  }

  const { rows: [padre] } = await q(
    'SELECT catalog_id FROM catalog WHERE alias = $1', [PADRE]
  )
  if (!padre) throw new Error(`No se encontro ${PADRE}: sin el no se sabe bajo que padre colgar la detraccion.`)

  const { rows: [creado] } = await q(
    `INSERT INTO catalog (alias, description, catalog_parent_id, active)
     VALUES ($1, 'Detraccion (SPOT)', $2, 'Y')
     RETURNING catalog_id`,
    [ALIAS, padre.catalog_id]
  )
  console.log(`[+] ${ALIAS} creado: catalog_id=${creado.catalog_id} (padre ${padre.catalog_id})`)
}

main()
  .catch(e => { console.error('[x]', e.message); process.exitCode = 1 })
  .finally(() => pool.end())
