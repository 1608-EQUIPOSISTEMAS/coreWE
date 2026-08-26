// ponytail: inspecciona los campos que trae sp_edition_tree_get (padre e hijo).
import { pool } from './db.mjs'
import { callProcedureReturningRows } from '../src/utils/spHelper.js'

const rows = await callProcedureReturningRows(pool, 'public.sp_edition_tree_get', [15955], { statementTimeoutMs: 25000 })
const row = Array.isArray(rows) ? rows[0] : rows
const { children, ...padre } = row
console.log('PADRE:', JSON.stringify(padre, null, 2))
const kids = typeof children === 'string' ? JSON.parse(children || '[]') : (children || [])
console.log('\nCLAVES DEL HIJO:', Object.keys(kids[0]).join(', '))

const { rows: tipos } = await pool.query(`
  SELECT DISTINCT c.alias FROM programs p JOIN catalog c ON c.catalog_id = p.cat_type_program
`)
console.log('\nTIPOS DE PROGRAMA:', tipos.map(t => t.alias).join(', '))
await pool.end()
