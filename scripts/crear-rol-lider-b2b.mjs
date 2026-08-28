// Alta del rol LIDER_B2B y su asignacion a un usuario.
//
// Por que existe este rol y no se reusa el rol B2B: el gate de las rutas es
// hasModuleOrRole('B2B', ...), que pasa por la matriz de Configuracion, asi que
// LIDER_B2B ve todos los registros de B2B sin tocar una linea de codigo ni
// redeployar. El rol B2B no sirve porque se llama "Asesor B2B Externo" y
// alimenta el dropdown de asesor de EnrollmentForm.vue (userListByRole('B2B')):
// un lider no debe aparecer ahi como asesor externo.
//
// Idempotente: se puede correr las veces que haga falta.
// Uso: node scripts/crear-rol-lider-b2b.mjs [user_id]   (por defecto 38, Naty)

import { q } from './db.mjs'

const ROLE_ALIAS = 'LIDER_B2B'
const ROLE_DESCRIPTION = 'Lider B2B'
const MODULE_CODE = 'B2B'
const userId = Number(process.argv[2] ?? 38)

async function ensureRole () {
  const existing = await q('SELECT rol_id FROM rol WHERE alias = $1', [ROLE_ALIAS])
  if (existing.rows.length) return existing.rows[0].rol_id

  // rol_id no es serial en esta BD: se asigna el siguiente libre a mano.
  const inserted = await q(
    `INSERT INTO rol (rol_id, alias, description)
     VALUES ((SELECT COALESCE(MAX(rol_id), 0) + 1 FROM rol), $1, $2)
     RETURNING rol_id`,
    [ROLE_ALIAS, ROLE_DESCRIPTION]
  )
  return inserted.rows[0].rol_id
}

async function grantModule (rolId) {
  await q(
    `INSERT INTO rol_module_permission (rol_id, module_id)
     SELECT $1, module_id FROM modules WHERE code = $2
     ON CONFLICT DO NOTHING`,
    [rolId, MODULE_CODE]
  )
}

// Solo los submodulos activos: CONVENIOS quedo en 'N' cuando se fusiono en
// Contratos (2026-08-17) y no debe reaparecer en el sidebar.
async function grantActiveSubmodules (rolId) {
  await q(
    `INSERT INTO rol_submodule_permission (rol_id, submodule_id)
     SELECT $1, s.submodule_id
       FROM submodules s
       JOIN modules m ON m.module_id = s.module_id
      WHERE m.code = $2 AND s.active = 'Y'
     ON CONFLICT DO NOTHING`,
    [rolId, MODULE_CODE]
  )
}

async function assignToUser (rolId) {
  const user = await q('SELECT user_id, name, email FROM users WHERE user_id = $1', [userId])
  if (!user.rows.length) throw new Error(`no existe el usuario ${userId}`)

  await q(
    `INSERT INTO user_roles (user_id, rol_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [userId, rolId]
  )
  return user.rows[0]
}

async function report (rolId) {
  const permisos = await q(
    `SELECT m.code AS modulo, s.code AS submodulo
       FROM rol_submodule_permission p
       JOIN submodules s ON s.submodule_id = p.submodule_id
       JOIN modules m ON m.module_id = s.module_id
      WHERE p.rol_id = $1 ORDER BY s.code`,
    [rolId]
  )
  const roles = await q(
    `SELECT r.alias FROM user_roles ur JOIN rol r ON r.rol_id = ur.rol_id
      WHERE ur.user_id = $1 ORDER BY r.alias`,
    [userId]
  )
  return { permisos: permisos.rows, roles: roles.rows.map(r => r.alias) }
}

const rolId = await ensureRole()
await grantModule(rolId)
await grantActiveSubmodules(rolId)
const user = await assignToUser(rolId)
const { permisos, roles } = await report(rolId)

console.log(`rol ${ROLE_ALIAS} = rol_id ${rolId}`)
console.log(`usuario ${user.user_id} (${user.name} / ${user.email}) roles:`, roles)
console.table(permisos)
process.exit(0)
