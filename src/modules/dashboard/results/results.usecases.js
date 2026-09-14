import { AREA_OF_LEADER } from '../../audit/audit.entity.js'
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
export async function areaResults (leaderKey, now = new Date()) {
  if (!Object.hasOwn(RESULTS_BY_LEADER, leaderKey ?? '')) return null
  return RESULTS_BY_LEADER[leaderKey]({ areaRoles: [...AREA_OF_LEADER[leaderKey]] }, now)
}

function lastDaysRange (now, days) {
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days)
  return { date_start: iso(start), date_end: iso(now) }
}
