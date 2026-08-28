// /comercial/leads no debe mostrar las consultas ni las ventas de Fundacion ni
// de B2B: cada area tiene su pantalla. El SP filtra por inclusion y no sabe de
// roles, asi que la pantalla manda owner_user_ids con su universo de asesores.
//
// Este check arma el MISMO universo que loadOwners() en Leads.vue y falla si
// entra un lead de las areas ajenas, o si el filtro se lleva por delante leads
// que si son de Comercial (los de asesores dados de baja, por ejemplo).
import { pool } from './db.mjs'

const ROLES_EXTRA  = ['LIDER_COMERCIAL', 'ADMIN', 'GERENCIA']
const ROLES_AJENOS = ['FUNDACION', 'LIDER_FUNDACION', 'B2B', 'LIDER_B2B']

function assert (condicion, mensaje) {
  if (!condicion) throw new Error(`FALLO: ${mensaje}`)
}

const idsPorRol = async (roles, soloActivos) => {
  const { rows } = await pool.query(
    `SELECT DISTINCT u.user_id
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.user_id
       JOIN rol r         ON r.rol_id   = ur.rol_id
      WHERE r.alias = ANY($1) AND ($2 = false OR u.active = 'Y')`,
    [roles, soloActivos])
  return rows.map(r => r.user_id)
}

// sp_user_list devuelve los COMERCIAL activos e inactivos; los demas roles
// llegan por sp_user_list_by_role, que si exige active = 'Y'.
const comerciales = await idsPorRol(['COMERCIAL'], false)
const extra       = await idsPorRol(ROLES_EXTRA, true)
const ajenos      = await idsPorRol(ROLES_AJENOS, true)
assert(ajenos.length > 0, 'no hay usuarios de Fundacion/B2B: el check no probaria nada')

const ownerIds = [...new Set([...comerciales, ...extra])].filter(id => !ajenos.includes(id))

const { rows: [reparto] } = await pool.query(
  `SELECT count(*) FILTER (WHERE l.user_registration_id = ANY($1)) AS visibles,
          count(*) FILTER (WHERE l.user_registration_id <> ALL($1)) AS ocultos
     FROM leads l`, [ownerIds])
console.log(`leads: ${reparto.visibles} visibles para Comercial, ${reparto.ocultos} fuera del universo`)

// Nadie debe quedar fuera salvo Fundacion y B2B: si aparece otro autor, el
// universo esta mal y la pantalla estaria escondiendo leads sin avisar.
const { rows: fuera } = await pool.query(
  `SELECT u.alias, count(*) AS leads
     FROM leads l JOIN users u ON u.user_id = l.user_registration_id
    WHERE l.user_registration_id <> ALL($1) AND l.user_registration_id <> ALL($2)
    GROUP BY 1`, [ownerIds, ajenos])
assert(fuera.length === 0,
  `hay leads de autores que no son de Fundacion/B2B fuera del universo: ${JSON.stringify(fuera)}`)

const cliente = await pool.connect()
try {
  await cliente.query('BEGIN')
  await cliente.query("CALL public.sp_comercial_lead_list($1::jsonb, 'cur_scope')",
    [JSON.stringify({ owner_user_ids: ownerIds, page: 1, size: 5000 })])
  const { rows } = await cliente.query('FETCH ALL FROM cur_scope')
  assert(rows.length > 0, 'el listado quedo vacio: el universo comercial se calculo mal')

  const { rows: [colados] } = await cliente.query(
    'SELECT count(*) AS n FROM leads WHERE lead_id = ANY($1) AND user_registration_id = ANY($2)',
    [rows.map(r => r.id), ajenos])
  assert(Number(colados.n) === 0, `${colados.n} lead(s) de Fundacion/B2B se colaron al listado`)

  console.log(`OK — ${rows.length} leads en la primera pagina, 0 de Fundacion/B2B`)
} finally {
  await cliente.query('ROLLBACK'); cliente.release(); await pool.end()
}
