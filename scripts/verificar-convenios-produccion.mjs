// Solo lectura: corre la query de la hoja "7. Convenios" contra produccion
// (tunel SSH 127.0.0.1:55432) para confirmar que las ventas B2B reales salen.
//
// La clave no se hardcodea ni se pasa por linea de comandos: sale del respaldo
// .env.bak-produccion, que ya la tiene apuntada al tunel. Si el tunel esta
// abajo, esto falla con ECONNREFUSED.
import fs from 'fs'
import pg from 'pg'
import { IntegrationRepository } from '../src/modules/integration/integration.repository.js'
import { buildConveniosRow, CONVENIOS_HEADER_ROW } from '../src/modules/integration/integration.entity.js'

const bak = fs.readFileSync(new URL('../.env.bak-produccion', import.meta.url), 'utf8')
const url = bak.match(/^\s*#?\s*DATABASE_URL=(postgresql:\/\/[^\s]+55432[^\s]*)/m)?.[1]
if (!url) throw new Error('no encontre la DATABASE_URL del tunel en .env.bak-produccion')

const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10000, keepAlive: true })

const { rows: janeth } = await pool.query(
  `SELECT enrollment_id, agent_origin, b2b_contract_id, cat_b2b_doctype, list_price, discount_amount, total_amount
     FROM public.enrollments WHERE enrollment_id = 16394`)
console.log('-- 16394 en produccion:', janeth)

const { rows: cuotas } = await pool.query(
  `SELECT installment_number, amount FROM public.payment_installments
    WHERE enrollment_id = 16394 ORDER BY 1`)
console.log('-- cuotas 16394:', cuotas)

const rows = await new IntegrationRepository(pool).getFicoConvenios()
console.log('\n-- filas de la hoja:', rows.length)
console.log(CONVENIOS_HEADER_ROW.join(' | '))
for (const r of rows) console.log(buildConveniosRow(r).map(v => v === '' ? '.' : v).join(' | '))
await pool.end()
