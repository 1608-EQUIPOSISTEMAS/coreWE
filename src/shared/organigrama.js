// Organigrama del ERP: que area es cada rol y como se llama en pantalla.
//
// Vive en shared/ y no dentro de un modulo porque no es de ninguno: la
// Auditoria decide con esto a quien audita cada lider, el Dashboard arma el
// panel de equipo, y Tickets deriva el area de quien reporta. Estaba en
// audit.entity y los otros dos modulos lo importaban de ahi, que es
// exactamente el cruce entre modulos que prohibe boundaries/dependencies:
// se hablan via shared/, no metiendo mano en los internals del vecino.
//
// Logica pura (un mapa y dos funciones sobre strings), asi que una entity lo
// puede importar sin dejar de ser pura.

// Cada lider ve su propia area: LIDER_COMERCIAL alcanza a los usuarios
// COMERCIAL y a los demas lideres comerciales, para que un equipo con dos jefes
// se vea completo.
export const AREA_OF_LEADER = {
  LIDER_COMERCIAL: ['COMERCIAL', 'LIDER_COMERCIAL'],
  LIDER_FICO: ['FICO', 'LIDER_FICO'],
  LIDER_ACADEMICA: ['ACADEMICA', 'LIDER_ACADEMICA'],
  LIDER_PRODUCTO: ['PRODUCTO', 'LIDER_PRODUCTO'],
  LIDER_FUNDACION: ['FUNDACION', 'LIDER_FUNDACION'],
  LIDER_B2B: ['B2B', 'LIDER_B2B']
}

// Nombre legible de cada area. Vive junto a AREA_OF_LEADER por la misma razon:
// es el mismo mapa (rol -> area), no un detalle de quien lo usa.
export const AREA_LABEL = {
  COMERCIAL: 'Comercial',
  FICO: 'FICO',
  ACADEMICA: 'Académica',
  PRODUCTO: 'Producto',
  FUNDACION: 'Fundación',
  B2B: 'B2B'
}

// A que area pertenece un conjunto de roles (los de un lider o los de quien
// creo un ticket). find(Boolean) y no un Set: si alguien tiene mas de un rol de
// area, se queda con el primero que matchea, no con "varias areas" a la vez.
export function areaLabelOf (roles = [], fallback = null) {
  return (roles || []).map(r => AREA_LABEL[r.replace(/^LIDER_/, '')]).find(Boolean) ?? fallback
}

// Nombre legible de UN rol puntual (a diferencia de areaLabelOf, que colapsa
// un lider y su base en la misma area). LIDER_COMERCIAL -> "Líder Comercial",
// COMERCIAL -> "Comercial", ADMIN -> "Administrador".
export function roleLabelOf (role) {
  if (!role) return null
  if (role === 'ADMIN') return 'Administrador'
  const esLider = role.startsWith('LIDER_')
  const base = esLider ? role.slice('LIDER_'.length) : role
  const nombreBase = AREA_LABEL[base] ?? base
  return esLider ? `Líder ${nombreBase}` : nombreBase
}
