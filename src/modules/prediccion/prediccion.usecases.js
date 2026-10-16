import { prediccionRepository as repo } from './prediccion.repository.js'
import { DomainError, NotFoundError } from '../../shared/errors.js'
import { summarizeHistory, buildOffers, CONVERSION_WINDOW_DAYS } from './prediccion.entity.js'
import { buildPlaybook } from './playbook.entity.js'
import { purchaseOutlook } from './outlook.entity.js'

// Hoy en Lima: el servidor corre en UTC y a las 19:00 de Lima ya seria manana.
const todayInLima = () => new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10)

const uniqueIds = (ids) => [...new Set(ids.filter((id) => id !== null && id !== undefined))]

// "Inscribir" clona la ultima consulta del ERP en el formulario de venta.
const lastErpLeadId = (history) =>
  history.filter((e) => e.source === 'ERP_LEAD').sort((a, b) => b.event_date.localeCompare(a.event_date))[0]?.source_id ?? null

// Ficha del cliente: que consulto, que compro, que tan probable es que compre
// ahora y que ofrecerle (con fecha y precio, para cerrar en la misma llamada).
export async function fichaDelCliente ({ phone, today = todayInLima() }) {
  const phoneKey = await repo.phoneKeyOf(phone)
  if (!phoneKey) throw new DomainError('Ese número no es un celular válido. Escríbelo con sus 9 dígitos (o con el código de país).')

  const history = await repo.historyOf(phoneKey)
  if (!history.length) {
    return { phone_key: phoneKey, nombre: null, resumen: summarizeHistory([], today), pronostico: null, historial: [], ofertas: [], lead_id: null }
  }

  const consultedIds = uniqueIds(history.filter((e) => e.event_type === 'CONSULTA').map((e) => e.program_id))
  const [nombre, inquiries, coPurchases] = await Promise.all([
    repo.nameOf(phoneKey),
    repo.inquiryConversion(consultedIds),
    repo.coPurchases(phoneKey)
  ])
  const candidateIds = uniqueIds([...consultedIds, ...coPurchases.flatMap((r) => [r.from_program, r.to_program])])
  const [programs, details] = await Promise.all([repo.programsByIds(candidateIds), repo.offerDetails(candidateIds, today)])

  return {
    phone_key: phoneKey,
    nombre,
    resumen: summarizeHistory(history, today),
    pronostico: purchaseOutlook(history, today),
    historial: history,
    ofertas: buildOffers({ history, inquiries, coPurchases, programs, details }),
    lead_id: lastErpLeadId(history)
  }
}

export const programasVendibles = () => repo.sellablePrograms()

// Manual de venta de un programa: lo que el asesor necesita con un numero nuevo.
export async function manualDelPrograma ({ programId, today = todayInLima() }) {
  const [program] = await repo.programsByIds([programId])
  if (!program) throw new NotFoundError('Ese programa no existe.')
  const [{ stats, destinations }, [detail]] = await Promise.all([
    repo.programPlaybook(programId, today, CONVERSION_WINDOW_DAYS),
    repo.offerDetails([programId], today)
  ])
  return buildPlaybook({ program, stats, destinations, detail })
}
