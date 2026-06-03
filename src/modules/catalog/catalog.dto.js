// Forma de salida hacia el cliente. Mantiene paridad con el service legacy.

// sp_catalog_list devuelve una unica fila con el mapa de catalogos en la
// columna 'result'. Se reenvia tal cual, sin aplanar ni envolver.
export const toCatalogDto = (rows) => rows?.[0]?.result ?? {}

// sp_membership_list devuelve filas ya paginadas. El cliente espera el array
// plano, sin envelope { total, page, size, items }.
export const toMembershipListDto = (rows) => rows || []
