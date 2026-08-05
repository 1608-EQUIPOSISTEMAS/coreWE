// Catalogos que hacen falta para pasar un enrollment "Al contado" -> "Cuotas":
// planes de pago (hermanos de 2466) y estados de cuota (hermanos de 2471).
//   node scripts/probe-cuotas-catalogo.mjs
import { q, pool } from './db.mjs'

const a = await q(`SELECT catalog_id, description, alias, active FROM catalog
  WHERE catalog_parent_id = (SELECT catalog_parent_id FROM catalog WHERE catalog_id=2466) ORDER BY catalog_id`)
console.log('--- planes de pago ---'); console.table(a.rows)

const b = await q(`SELECT catalog_id, description, alias, active FROM catalog
  WHERE catalog_parent_id = (SELECT catalog_parent_id FROM catalog WHERE catalog_id=2471) ORDER BY catalog_id`)
console.log('--- estados de cuota ---'); console.table(b.rows)

const c = await q(`SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns WHERE table_name='payment_installments' ORDER BY ordinal_position`)
console.log('--- payment_installments ---'); console.table(c.rows)

await pool.end()
