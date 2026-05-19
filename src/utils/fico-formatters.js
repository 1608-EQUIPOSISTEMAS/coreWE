// Helpers de formato y reglas de negocio del modulo FICO sin dependencias
// externas (no tocan BD ni servicios). Son las primitivas que comparten
// confirmaciones, membresia y course change.

// La membresia siempre es de 12 meses (regla de negocio actual). Si el dia de
// manana se hace configurable por programa, este es el unico punto a tocar.
export const MEMBERSHIP_DURATION_MONTHS = 12

// Formato dd/mm/yyyy usando getters UTC. Postgres parsea columnas DATE como
// UTC-medianoche en JS; usar getDate()/toLocaleDateString aplicaria la TZ del
// proceso Node y restaria 1 dia en prod (UTC) frente a local (Lima). UTC
// getters leen los componentes "tal cual los puso pg".
export function formatCalendarDate (raw) {
  if (!raw) return '---'
  const d = raw instanceof Date ? raw : new Date(raw)
  if (isNaN(d)) return '---'
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getUTCFullYear()}`
}

// Suma meses preservando "ultimo dia del mes" cuando el destino es mas corto
// (31 ene + 1 mes = 28/29 feb, no 3 mar). setUTCMonth puro causa overflow al
// mes siguiente, asi que detectamos el cambio de dia y rebobinamos a fin de mes.
export function addMonthsCalendar (raw, months) {
  if (!raw) return null
  const base = raw instanceof Date ? new Date(raw.getTime()) : new Date(raw)
  if (isNaN(base)) return null
  const originalDay = base.getUTCDate()
  base.setUTCMonth(base.getUTCMonth() + months)
  if (base.getUTCDate() !== originalDay) base.setUTCDate(0)
  return base
}

// Determina si un programa es de membresia. El flag explicito gana siempre.
// El fallback heuristico cubre nombres historicos cuando la query no trae el flag.
export function isMembership (programName, isMembershipFlag = null) {
  if (isMembershipFlag === true) return true
  if (isMembershipFlag === false) return false
  const name = (programName || '').toUpperCase()
  return name.includes('MEMB') || name.includes('PLUS') || name.includes('PLAT') || name.includes('BLACK') || name.includes('GOLD')
}
