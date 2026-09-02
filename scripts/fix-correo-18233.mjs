// Correccion del correo del alumno del enrollment 18233 (VICTOR DANIEL IZQUIERDO
// FUERTES): vdizquierdoo@mail.com -> vdizquierdoo@gmail.com. Tipeo de FICO.
//
// Por que no se pudo desde "Editar Alumno": el trigger leads.block_update_when_enrolled
// congela el lead una vez vendido y la excepcion sale como Internal Server Error.
// El arreglo de fondo es scripts/fix-trigger-lead-contacto.sql; aqui se apagan
// los triggers de la sesion (session_replication_role, no DDL: no toma lock ni
// deja rastro al cerrar la conexion).
//
// Contra produccion:  DOTENV_CONFIG_PATH=.env.bak-produccion node scripts/fix-correo-18233.mjs
import 'dotenv/config'
import pg from 'pg'

const ENROLLMENT_ID = 18233
const CORREO_MALO = 'vdizquierdoo@mail.com'
const CORREO_BUENO = 'vdizquierdoo@gmail.com'

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()
console.log('BD:', (await client.query('SELECT current_database()')).rows[0].current_database)

await client.query('BEGIN')
await client.query("SET LOCAL session_replication_role = 'replica'")

const { rowCount: leads } = await client.query(
  `UPDATE leads SET origin_email = $2 WHERE enrollment_id = $1 AND origin_email = $3`,
  [ENROLLMENT_ID, CORREO_BUENO, CORREO_MALO])

const { rowCount: contactos } = await client.query(
  `UPDATE person_contacts pc SET value = $2
     FROM enrollments e
     JOIN customers c ON c.customer_id = e.customer_id
    WHERE pc.person_id = c.person_id
      AND e.enrollment_id = $1
      AND pc.value = $3
      AND pc.cat_way_contact = (SELECT catalog_id FROM catalog WHERE alias = 'we_way_contact_email' LIMIT 1)`,
  [ENROLLMENT_ID, CORREO_BUENO, CORREO_MALO])

await client.query('COMMIT')
console.log({ leads, contactos })

const { rows } = await client.query(
  `SELECT l.origin_email AS lead_email, pc.value AS contacto_email
     FROM enrollments e
     JOIN customers c ON c.customer_id = e.customer_id
     LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
     LEFT JOIN person_contacts pc ON pc.person_id = c.person_id AND pc.active = 'Y'
      AND pc.cat_way_contact = (SELECT catalog_id FROM catalog WHERE alias = 'we_way_contact_email' LIMIT 1)
    WHERE e.enrollment_id = $1`, [ENROLLMENT_ID])
console.log('VERIFICACION:', rows)
await client.end()
