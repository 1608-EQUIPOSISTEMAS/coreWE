// Verificacion de la ficha del docente: que sp_instructor_update escriba los
// usuarios de Odoo/Teams y la lista de carpetas, y que sp_instructor_get las
// devuelva. Todo dentro de una transaccion con ROLLBACK.
//
// Uso: node scripts/probe-instructor-folders.mjs [instructor_id]
import { pool } from './db.mjs'

const instructorId = Number(process.argv[2]) || 2180
const conn = await pool.connect()

// Un cursor por lectura: dentro de la misma transaccion el nombre no se libera.
async function fichaDe (conn, cursor) {
  await conn.query('CALL public.sp_instructor_get($1, $2)', [instructorId, cursor])
  const { rows } = await conn.query(`FETCH ALL FROM ${cursor}`)
  return rows[0]
}

try {
  await conn.query('BEGIN')

  const antes = await fichaDe(conn, 'cur_antes')
  if (!antes) throw new Error(`no existe el instructor ${instructorId}`)
  console.log(`docente ${instructorId}: ${antes.first_name} ${antes.last_name}`)

  await conn.query('CALL public.sp_instructor_update($1, $2, $3)', [
    instructorId,
    JSON.stringify({
      odoo_username: 'docente.prueba',
      odoo_password: 'clave-odoo',
      teams_username: 'docente@weeducacion.com',
      teams_password: 'clave-teams',
      class_folders: [
        { label: 'Clase 1', folder_url: 'https://drive/c1' },
        { label: null, folder_url: 'https://drive/c2' },
        { label: 'vacia', folder_url: '   ' } // se descarta: sin URL no hay carpeta
      ]
    }),
    'cur_update'
  ])
  await conn.query('FETCH ALL FROM cur_update')

  const despues = await fichaDe(conn, 'cur_despues')
  await conn.query('ROLLBACK')

  const carpetas = despues.class_folders || []
  const checks = [
    ['odoo_username', despues.odoo_username === 'docente.prueba'],
    ['odoo_password', despues.odoo_password === 'clave-odoo'],
    ['teams_username', despues.teams_username === 'docente@weeducacion.com'],
    ['teams_password', despues.teams_password === 'clave-teams'],
    ['guarda 2 carpetas y descarta la vacia', carpetas.length === 2],
    ['conserva el orden y la URL', carpetas[0]?.folder_url === 'https://drive/c1'],
    ['acepta carpeta sin etiqueta', carpetas[1]?.label === null],
    ['no toca los programas', (despues.programs || []).length === (antes.programs || []).length],
    ['no toca los financials', (despues.financials || []).length === (antes.financials || []).length]
  ]
  for (const [nombre, ok] of checks) {
    console.log(`${ok ? 'OK  ' : 'FALLA'} ${nombre}`)
    if (!ok) process.exitCode = 1
  }
} finally {
  conn.release()
  await pool.end()
}
