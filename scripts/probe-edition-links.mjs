// Verificacion de los links de aula (WhatsApp / Teams / Ficha / Lista de notas):
// que las columnas existan y que sp_edition_by_week_list las devuelva en el JSON
// que consume Producto > Cronograma.
import { pool } from './db.mjs'

const conn = await pool.connect()
try {
  const columnas = await conn.query(`
    SELECT column_name
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'program_editions'
       AND column_name IN ('whatsapp_link', 'teams_link', 'ficha_link', 'grades_link')
     ORDER BY column_name
  `)
  console.log('columnas:', columnas.rows.map(r => r.column_name).join(', '))

  const hoy = new Date()
  const filtros = { year: hoy.getFullYear(), month: hoy.getMonth() + 1 }

  await conn.query('BEGIN')
  await conn.query('CALL public.sp_edition_by_week_list($1, $2)', [JSON.stringify(filtros), 'cur_links'])
  const { rows } = await conn.query('FETCH ALL FROM cur_links')
  await conn.query('COMMIT')

  const items = rows.flatMap(r => r.items || [])
  console.log(`semanas: ${rows.length} | ediciones: ${items.length}`)
  if (!items.length) throw new Error('el SP no devolvio ediciones: no se puede verificar el JSON')

  // La clave tiene que VENIR en el objeto aunque el link este vacio: si el SP no
  // la arma, el front nunca podria mostrar ni guardar la columna.
  for (const clave of ['whatsapp_link', 'teams_link', 'ficha_link', 'grades_link']) {
    const presente = clave in items[0]
    console.log(`${clave}: ${presente ? 'OK' : 'FALTA en el JSON del SP'}`)
    if (!presente) process.exitCode = 1
  }

  // Guardado real contra el SP, con ROLLBACK: replica el payload minimo que manda
  // el front (solo el link editado + notes) y verifica lo que de verdad importa:
  // que el link se escriba, que el link vecino NO se pise y que notes sobreviva.
  const edicion = items[0].edition_num_id
  const admin = await conn.query(`
    SELECT ur.user_id FROM public.user_roles ur
      JOIN public.rol r ON r.rol_id = ur.rol_id
      JOIN public.users u ON u.user_id = ur.user_id
     WHERE r.alias = 'ADMIN' AND u.active = 'Y' LIMIT 1
  `)
  if (!admin.rows.length) throw new Error('sin usuario ADMIN: el SP rechazaria el update')

  await conn.query('BEGIN')
  const previo = await conn.query(
    'SELECT notes, teams_link FROM public.program_editions WHERE edition_num_id = $1', [edicion]
  )
  await conn.query('CALL public.sp_edition_update($1, $2, $3)', [
    JSON.stringify({ edition_num_id: edicion, notes: previo.rows[0].notes || '', ficha_link: 'https://prueba/ficha' }),
    JSON.stringify(admin.rows[0].user_id),
    'cur_update'
  ])
  console.log('SP dice:', (await conn.query('FETCH ALL FROM cur_update')).rows[0])
  const post = await conn.query(
    'SELECT ficha_link, teams_link, notes FROM public.program_editions WHERE edition_num_id = $1', [edicion]
  )
  await conn.query('ROLLBACK')

  const guardado = post.rows[0].ficha_link === 'https://prueba/ficha'
  const vecinoIntacto = post.rows[0].teams_link === previo.rows[0].teams_link
  const notasIntactas = (post.rows[0].notes || '') === (previo.rows[0].notes || '')
  console.log(`escribe ficha_link: ${guardado ? 'OK' : 'FALLA'}`)
  console.log(`no pisa teams_link: ${vecinoIntacto ? 'OK' : 'FALLA'}`)
  console.log(`conserva notes: ${notasIntactas ? 'OK' : 'FALLA'}`)
  if (!guardado || !vecinoIntacto || !notasIntactas) process.exitCode = 1
} finally {
  conn.release()
  await pool.end()
}
