// Verifica el efecto real de desactivar customers 18387 sobre las dos busquedas
// de alumnos del ERP. Solo LECTURA.
//   - sp_customer_caller  -> autocomplete al registrar (el backend pasa active='Y')
//   - sp_customer_list    -> grid de clientes (el backend pasa active=null)
import 'dotenv/config'
import pg from 'pg'
const m = (process.env.DATABASE_URL || '').match(/^postgresql:\/\/([^:]+):([^@]+)@/)
const c = new pg.Client({ host: '127.0.0.1', port: 55432, database: 'neondb', user: 'postgres', password: process.env.PGPASSWORD || decodeURIComponent(m[2]) })
await c.connect()

const DUP = 18387
const pinta = (label, rows, cols) => {
  console.log('\n=== ' + label + ' (' + rows.length + ' filas) ===')
  console.table(rows.map(r => Object.fromEntries(cols.map(k => [k, r[k]]))))
  const hay = rows.some(r => Number(r.customer_id) === DUP)
  console.log(hay ? '>>> EL DUPLICADO 18387 APARECE' : '>>> el duplicado 18387 NO aparece')
  return hay
}

// --- autocomplete (sp_customer_caller): el backend pasa 'Y' ---
await c.query('BEGIN')
await c.query('CALL public.sp_customer_caller($1,$2,$3)', ['Y', 'CARLOTA', 'cur'])
const caller = (await c.query('FETCH ALL FROM "cur"')).rows
await c.query('ROLLBACK')
const enCaller = pinta("sp_customer_caller(active='Y', q='CARLOTA')  [autocomplete de registro]",
  caller, ['customer_id', 'person_id', 'full_name', 'active'])

// --- grid (sp_customer_list): el backend pasa active=null ---
const corrList = async (activeParam) => {
  await c.query('BEGIN')
  await c.query('CALL public.sp_customer_list($1,$2,$3,$4,$5,$6,$7)', [activeParam, null, null, 'CARLOTA', 1, 25, 'cur'])
  const rows = (await c.query('FETCH ALL FROM "cur"')).rows
  await c.query('ROLLBACK')
  return rows
}
const enListNull = pinta("sp_customer_list(active=NULL, q='CARLOTA')  [grid real del ERP]",
  await corrList(null), ['customer_id', 'person_id', 'display_name', 'customer_active'])
const enListY = pinta("sp_customer_list(active='Y', q='CARLOTA')  [si el grid filtrara activos]",
  await corrList('Y'), ['customer_id', 'person_id', 'display_name', 'customer_active'])

console.log('\n---------------- RESUMEN ----------------')
console.log('autocomplete de registro      :', enCaller ? 'TODAVIA lo muestra' : 'LIMPIO')
console.log('grid de clientes (active=null):', enListNull ? 'TODAVIA lo muestra' : 'LIMPIO')
console.log('grid si filtrara active=Y     :', enListY ? 'TODAVIA lo muestra' : 'LIMPIO')
await c.end()
