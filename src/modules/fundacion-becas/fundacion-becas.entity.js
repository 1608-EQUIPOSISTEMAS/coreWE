import { DomainError } from '../../shared/errors.js'

// Becas de Fundacion (reemplaza el sheet "Gestion de Becas 2026"). Una beca da
// acceso a UN curso y termina cuando el curso termina (pedido del area, 27/10/26).
// Las fechas viajan como 'YYYY-MM-DD': se comparan como texto sin zona horaria.

export const AGREEMENT_TYPES = ['CONVENIO', 'AUSPICIO']
export const SCHOLARSHIP_TYPES = ['COMPLETA', 'SEMIBECA']
export const STATUSES = ['pending', 'active', 'expired']

// Alias de catalog.cat_model_modality. Online no tiene ediciones en el ERP.
const ONLINE = 'we_modality_online'

// En vivo/presencial: la edicion manda. Online: access_until, que se llena a mano
// mientras no exista la regla del plazo; sin el, la beca no tiene fin conocido.
export function scholarshipEndDate ({ edition_end_date: editionEnd, access_until: accessUntil }) {
  return editionEnd || accessUntil || null
}

// Estado de la beca para el "hoy" de Lima. endDate puede ser null (online sin plazo).
// - El dia del fin aun es activa: el becario conserva el curso hasta esa fecha
//   (mismo criterio que Membresias).
// - Sin activar y con el curso terminado es vencida, no pendiente: ya no hay
//   nada que activar y no debe quedar como tarea en la bandeja de Fundacion.
export function scholarshipStatus ({ activatedAt, endDate }, today) {
  if (endDate && endDate < today) return 'expired'
  return activatedAt ? 'active' : 'pending'
}

// Online sin edicion; en vivo/presencial con una edicion de ESE programa, que es
// de donde sale el fin de la beca.
export function assertCourseChoice (course, editionId) {
  if (!course) throw new DomainError('El curso no existe', { statusCode: 422 })
  if (course.modality_alias === ONLINE) {
    if (editionId) throw new DomainError('Un curso online no tiene edición', { statusCode: 422 })
    return
  }
  if (!editionId) throw new DomainError('Elige la edición del curso: de ahí sale el fin de la beca', { statusCode: 422 })
  if (!course.edition_matches) throw new DomainError('La edición no pertenece al curso', { statusCode: 422 })
}

// Una persona tiene UNA beca por curso (y por edicion, en vivo/presencial): el
// DNI se compara sin espacios ni minusculas para que "12345678 " no se cuele
// como otra persona. Online va sin edicion aunque el formulario mande una.
export function normalizeScholarship (data) {
  return {
    ...data,
    document_number: data.document_number.trim().toUpperCase(),
    program_edition_id: data.program_edition_id || null
  }
}

export function duplicateMessage (existing) {
  return `Esta persona ya tiene una beca en este curso (registro #${existing.scholarship_id}, ${existing.partner_name}).`
}

const countByStatus = (items) => Object.fromEntries(
  STATUSES.map(s => [s, items.filter(i => i.status === s).length])
)

// Pega estado y fin a cada beca y arma los totales: por estado y por modalidad.
export function summarizeScholarships ({ today, rows }) {
  const items = rows.map(r => {
    const end_date = scholarshipEndDate(r)
    return { ...r, end_date, status: scholarshipStatus({ activatedAt: r.activated_at, endDate: end_date }, today) }
  })
  const modalities = [...new Set(items.map(i => i.modality))].sort()
  return {
    today,
    items,
    kpis: { total: items.length, ...countByStatus(items), converted: items.filter(converted).length },
    byModality: modalities.map(modality => {
      const of = items.filter(i => i.modality === modality)
      return { modality, total: of.length, ...countByStatus(of) }
    }),
    byPartner: conversionByPartner(items)
  }
}

// Becario convertido = compro OTRO curso despues de su beca (purchases lo cuenta
// el repositorio). Es la metrica para decidir que convenios renovar.
const converted = i => i.purchases > 0

function conversionByPartner (items) {
  const partners = [...new Set(items.map(i => i.partner_name))]
  return partners
    .map(partner => {
      const of = items.filter(i => i.partner_name === partner)
      const conv = of.filter(converted).length
      return { partner, total: of.length, converted: conv, rate: Math.round(100 * conv / of.length) }
    })
    .sort((a, b) => b.total - a.total || a.partner.localeCompare(b.partner))
}

// Umbrales del aviso diario a Fundacion.
export const ALERT_PENDING_DAYS = 3
export const ALERT_EXPIRING_DAYS = 7

const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)

// Lo que Fundacion tiene que mover: pendientes que esperan mas de 3 dias (el
// becario no puede empezar) y activas cuyo curso termina en 7 dias o menos (aun
// hay tiempo de avisarle). Online sin plazo nunca entra en "por vencer".
export function scholarshipAlerts (items, today) {
  const pendingBefore = addDays(today, -ALERT_PENDING_DAYS)
  const expiringBy = addDays(today, ALERT_EXPIRING_DAYS)
  return {
    stalePending: items.filter(i => i.status === 'pending' && i.registration_date < pendingBefore),
    expiringSoon: items.filter(i => i.status === 'active' && i.end_date && i.end_date <= expiringBy)
  }
}
