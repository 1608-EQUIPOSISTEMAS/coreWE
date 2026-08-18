// One-off (18/08/2026): el lead 428323 (Miryam Marycruz Zapata Zapata, enrollment
// 16647, V Congreso de Direccion de Proyectos) llego con el mensaje generico de
// Facebook. El origen real es el grupo de estudio, asi que se corrige el mensaje
// inicial y se le pone la estrategia que faltaba.
//
// Correr con PGPASSWORD exportada (produccion, autorizado por el usuario).
import { q, pool } from './db.mjs'

const LEAD_ID = 428323
const MENSAJE =
  'Hola soy CWE, vi esto en el grupo de estudio y deseo información del Congreso de Proyectos'
const ALIAS_ESTRATEGIA = 'we_type_strategy_study_group'

const mostrar = async (titulo) => {
  const { rows } = await q(
    `SELECT l.lead_id, l.origin_phone, l.cat_type_strategy, c.description AS estrategia,
            l.message_init_conversation, l.modification_date
       FROM leads l
       LEFT JOIN catalog c ON c.catalog_id = l.cat_type_strategy
      WHERE l.lead_id = $1`,
    [LEAD_ID]
  )
  console.log(titulo)
  console.dir(rows[0], { depth: null })
}

await mostrar('ANTES:')

const { rowCount } = await q(
  `UPDATE leads
      SET message_init_conversation = $2,
          cat_type_strategy = (SELECT catalog_id FROM catalog WHERE alias = $3),
          modification_date = NOW()
    WHERE lead_id = $1`,
  [LEAD_ID, MENSAJE, ALIAS_ESTRATEGIA]
)
console.log(`\nfilas actualizadas: ${rowCount}\n`)

await mostrar('DESPUES:')
await pool.end()
