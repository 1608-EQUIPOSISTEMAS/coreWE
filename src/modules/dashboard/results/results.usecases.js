import { AREA_OF_LEADER } from '../../../shared/organigrama.js'
import { editionTeacherFollowup } from '../../edition/edition.usecases.js'
import { fetchComercialRaw } from './comercial.repository.js'
import { buildComercialResults } from './comercial.entity.js'
import { fetchFicoRaw } from './fico.repository.js'
import { buildFicoResults } from './fico.entity.js'
import { fetchProductoRaw } from './producto.repository.js'
import { buildProductoResults } from './producto.entity.js'
import { fetchAcademicaRaw } from './academica.repository.js'
import { buildAcademicaResults } from './academica.entity.js'
import { fetchFundacionRaw } from './fundacion.repository.js'
import { buildFundacionResults } from './fundacion.entity.js'
import { fetchB2bRaw } from './b2b.repository.js'
import { buildB2bResults } from './b2b.entity.js'
import { fetchAreaTicketsRaw } from './tickets.repository.js'
import { buildTicketRows, AMBITO_PERSONAL, AMBITO_GLOBAL } from './tickets.entity.js'
import { safeAsync } from '../../../shared/utils/safe-async.js'

// Indicadores de resultado del área que lidera quien consulta.
//
// Cada área es un par repository (filas crudas) + entity (regla y semáforo).
// Este mapa es el único lugar que conoce a las seis: agregar un área es una
// línea aquí y su par de archivos, sin tocar el panel.
const RESULTS_BY_LEADER = {
  LIDER_COMERCIAL: async (scope, now) => buildComercialResults(await fetchComercialRaw(scope), now),
  LIDER_FICO: async (scope, now) => buildFicoResults(await fetchFicoRaw(scope), now),
  LIDER_PRODUCTO: async (scope, now) => buildProductoResults(await fetchProductoRaw(scope), now),
  // El cumplimiento de sesiones sale del mismo cronograma derivado (S1..Sn con
  // reprogramaciones) que el Seguimiento Docentes; recalcularlo en SQL daría
  // otra cifra desde la primera reprogramación.
  LIDER_ACADEMICA: async (scope, now) => {
    const [raw, seguimiento] = await Promise.all([
      fetchAcademicaRaw(scope),
      editionTeacherFollowup(lastDaysRange(now, 30))
    ])
    return buildAcademicaResults({ ...raw, seguimiento }, now)
  },
  LIDER_FUNDACION: async (scope, now) => buildFundacionResults(await fetchFundacionRaw(scope), now),
  LIDER_B2B: async (scope, now) => buildB2bResults(await fetchB2bRaw(scope), now)
}

// null = sin resultados (ADMIN "Todas las áreas" o un colaborador).
//
// El soporte es transversal: los dos reportes de tickets (estado y tiempos de
// respuesta) se anexan al final del panel de las seis áreas en vez de repetirse
// dentro de cada build<Area>Results. Ocupan el lugar que tenía "Correcciones de
// ventas", con la misma pregunta detrás: qué le está costando al equipo.
export async function areaResults (leaderKey, now = new Date()) {
  if (!Object.hasOwn(RESULTS_BY_LEADER, leaderKey ?? '')) return null

  const scope = { areaRoles: [...AREA_OF_LEADER[leaderKey]] }
  const [panel, tickets] = await Promise.all([
    RESULTS_BY_LEADER[leaderKey](scope, now),
    // Best-effort: el soporte es un añadido al panel. Si sus tablas todavía no
    // existen (DDL sin correr) o la consulta falla, el líder tiene que seguir
    // viendo sus ventas y su cobranza, no un 500.
    safeAsync('[dashboard][tickets]', () => fetchAreaTicketsRaw(scope))
  ])

  // Un área sin tickets no ve filas vacías: row() ya devuelve null sin widgets.
  const filasTickets = tickets ? buildTicketRows(tickets, now) : []
  return { ...panel, filas: [...panel.filas, ...filasTickets] }
}

// Panel de soporte de un colaborador sin rol de liderazgo: no tiene area
// propia en el ticket (esa la tiene el lider), tiene AUTORIA. Mismo contrato
// de widgets que el panel de area, con el alcance acotado a lo que el mismo
// reporto. Best-effort por la misma razon que en areaResults: un fallo aqui
// no debe tumbar el resto del panel de "mi actividad".
export async function myTicketReports (userId, now = new Date()) {
  if (!userId) return null
  const tickets = await safeAsync('[dashboard][tickets:mine]', () => fetchAreaTicketsRaw({ userId }))
  if (!tickets) return null
  const filas = buildTicketRows(tickets, now, AMBITO_PERSONAL)
  return filas.length ? { filas } : null
}

// Panel de soporte para el ADMIN viendo "toda la empresa": sin areaRoles ni
// userId, fetchAreaTicketsRaw no filtra nada (los dos filtros son NULL-abiertos),
// asi que esto es, a proposito, el total de tickets de la organizacion.
export async function orgTicketReports (now = new Date()) {
  const tickets = await safeAsync('[dashboard][tickets:org]', () => fetchAreaTicketsRaw({}))
  if (!tickets) return null
  const filas = buildTicketRows(tickets, now, AMBITO_GLOBAL)
  return filas.length ? { filas } : null
}

function lastDaysRange (now, days) {
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days)
  return { date_start: iso(start), date_end: iso(now) }
}
