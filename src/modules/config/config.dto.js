// Mapeo de filas crudas de BD a la forma que consume el frontend.

export function toUserDto (row) {
  return {
    user_id: row.user_id,
    person_id: row.person_id,
    alias: row.alias,
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name,
    full_name: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
    active: row.active,
    telefonos: row.telefonos || [],
    roles: row.roles || []
  }
}

export function toUserListDto (rows = []) {
  return rows.map(toUserDto)
}

export function toRoleDto (row) {
  return {
    rol_id: row.rol_id,
    description: row.description,
    alias: row.alias,
    user_count: row.user_count ?? 0,
    module_ids: row.module_ids || [],
    submodule_ids: row.submodule_ids || []
  }
}

export function toRoleListDto (rows = []) {
  return rows.map(toRoleDto)
}

export function toModuleListDto (rows = []) {
  return rows.map(row => ({
    module_id: row.module_id,
    code: row.code,
    name: row.name,
    icon: row.icon,
    route: row.route,
    active: row.active,
    submodules: row.submodules || []
  }))
}
