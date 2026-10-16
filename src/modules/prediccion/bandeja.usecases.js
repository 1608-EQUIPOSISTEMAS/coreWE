import { withTransaction } from '../../shared/db/pool.js'
import { DomainError, ForbiddenError, NotFoundError } from '../../shared/errors.js'
import { bandejaRepository as repo } from './bandeja.repository.js'
import { prediccionRepository } from './prediccion.repository.js'
import { offerContext } from './prediccion.entity.js'
import {
  rankCandidates, distribute, controlWithinReach, addDays, isControl, nextStep, followUpSchedule, lowLevelFollowUps,
  LOCK_DAYS, OUTCOMES, MAX_OPEN_PER_ADVISOR
} from './bandeja.entity.js'
import { buildMeasurement, MEASURE_WINDOW_DAYS } from './medicion.entity.js'

// Hoy en Lima: el servidor corre en UTC y a las 19:00 de Lima ya seria manana.
const todayInLima = () => new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10)

// Un lider ve y opera la bandeja de cualquier asesor; el asesor, solo la suya.
const LEADER_ROLES = ['ADMIN', 'LIDER_COMERCIAL', 'GERENCIA']
const isLeader = (requester) => LEADER_ROLES.some((r) => requester.roles?.includes(r))

// Cualquier numero fijo sirve mientras sea el mismo en todos los procesos.
const GENERATION_LOCK_KEY = 72_017_015

const followUpsFrom = (rows, reason, today) => rows.flatMap((r) => followUpSchedule(today).map((f) => ({
  ...f, phone_key: r.phone_key, client_name: r.client_name, program_id: r.program_id, user_id: r.user_id, reason
})))

// Cierra lo comprado y lo vencido (que pasa a la cadencia), reparte ALTA y MEDIA
// entre los asesores y arma la cadencia de los BAJA. Idempotente en el dia:
// correrla dos veces solo rellena hasta el tope.
export async function generarBandeja ({ today = todayInLima() } = {}) {
  return withTransaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock($1)', [GENERATION_LOCK_KEY])
    const compraron = await repo.closePurchased(db, today)
    const vencidos = await repo.expireOverdue(db, today)
    const candidates = await repo.candidates(db, today)
    const ranked = rankCandidates(candidates)
    // El control se sortea ANTES del reparto (fijo por telefono) y se recorta al
    // mismo rango del ranking que alcanzo el cupo: asi se compara lo comparable.
    const advisors = await repo.advisorsWithLoad(db)
    const assignments = distribute({ ranked: ranked.filter((c) => !isControl(c.phone_key)), advisors })
    const control = controlWithinReach({ control: ranked.filter((c) => isControl(c.phone_key)), assigned: assignments })
      .map((c) => ({ ...c, is_control: true, user_id: null }))
    const period = { today, expiresOn: addDays(today, LOCK_DAYS) }
    const asignados = await repo.insertAssignments(db, assignments, period)
    const enControl = await repo.insertAssignments(db, control, period)
    const cadencia = await repo.insertFollowups(db, [
      ...followUpsFrom(vencidos, 'VENCIDO', today),
      ...lowLevelFollowUps({ candidates, advisors, today })
    ])
    const cadenciaCancelada = await repo.cancelStaleFollowups(db, today)
    return {
      today, compraron, vencidos: vencidos.length, candidatos: ranked.length, asesores: advisors.length,
      asignados, control: enControl, cadencia, cadencia_cancelada: cadenciaCancelada
    }
  })
}

function resolveOwner ({ userId, requester }) {
  if (!userId || userId === requester.id) return requester.id
  if (!isLeader(requester)) throw new ForbiddenError('Solo un líder puede ver la bandeja de otro asesor.')
  return userId
}

const resumenDesde = (closed) => {
  const by = Object.fromEntries(closed.map((r) => [r.outcome, r.total]))
  return {
    cerrados: closed.reduce((s, r) => s + r.total, 0),
    // INSCRITO lo marca el asesor; COMPRO lo cierra solo la venta del ERP.
    compraron: (by.COMPRO ?? 0) + (by.INSCRITO ?? 0),
    // Suma de probabilidades = cuantas compras se esperaban de esos clientes.
    compras_esperadas: Math.round(closed.reduce((s, r) => s + r.expected_pct, 0)) / 100,
    vencidos: by.VENCIDO ?? 0
  }
}

export async function bandejaDe ({ userId, requester, today = todayInLima() }) {
  const owner = resolveOwner({ userId, requester })
  const [abiertos, seguimientos, contactados, closed, asesores] = await Promise.all([
    repo.openAssignmentsOf(owner, today),
    repo.followupsDueOf(owner, today),
    repo.contactedOn(owner, today),
    repo.closedSince(owner, addDays(today, -30)),
    isLeader(requester) ? repo.advisorsWithLoad() : Promise.resolve([])
  ])
  // Fecha y precio de lo que consulto: el mismo "plus" que la ficha, para que el
  // asesor mande la propuesta desde la bandeja sin abrir nada mas.
  const programIds = [...new Set([...abiertos, ...seguimientos].map((a) => a.program_id).filter(Boolean))]
  const details = new Map((await prediccionRepository.offerDetails(programIds, today)).map((d) => [d.program_id, d]))
  const withOffer = (a) => ({ ...a, ...offerContext(details.get(a.program_id)) })
  return {
    user_id: owner,
    today,
    abiertos: abiertos.map(withOffer),
    seguimientos: seguimientos.map(withOffer),
    contactados_hoy: contactados,
    tope: MAX_OPEN_PER_ADVISOR,
    ultimos_30_dias: resumenDesde(closed),
    asesores
  }
}

export async function registrarResultado ({ assignmentId, outcome, requester, today = todayInLima() }) {
  if (!OUTCOMES.includes(outcome)) throw new DomainError(`Resultado no válido: ${outcome}`)
  return withTransaction(async (db) => {
    const assignment = await repo.assignmentById(db, assignmentId)
    if (!assignment || assignment.is_control) throw new NotFoundError('Ese cliente ya no está en la bandeja.')
    if (assignment.user_id !== requester.id && !isLeader(requester)) {
      throw new ForbiddenError('Ese cliente está asignado a otro asesor.')
    }
    if (assignment.outcome) throw new DomainError('Ese cliente ya se cerró (compró, venció o tenía resultado).', { statusCode: 409 })
    const step = nextStep({ outcome, attempts: assignment.attempts, today })
    await repo.logCall(db, { assignment, outcome, userId: requester.id })
    await repo.applyStep(db, { assignmentId, outcome, step, userId: requester.id })
    if (step.startFollowUp) await repo.insertFollowups(db, followUpsFrom([assignment], 'SIN_RESPUESTA', today))
    return { assignment_id: assignmentId, outcome, cerrado: Boolean(step.close), vuelve_el: step.nextContactOn, cadencia: step.startFollowUp }
  })
}

// El asesor mando el mensaje del dia de la cadencia.
export async function marcarSeguimiento ({ followupId, requester }) {
  const followup = await repo.followupById(followupId)
  if (!followup) throw new NotFoundError('Ese seguimiento no existe.')
  if (followup.user_id !== requester.id && !isLeader(requester)) throw new ForbiddenError('Ese seguimiento es de otro asesor.')
  if (!await repo.markFollowupDone(followupId)) throw new DomainError('Ese seguimiento ya estaba hecho o se canceló.', { statusCode: 409 })
  return { followup_id: followupId }
}

// ¿La bandeja hace vender mas? Llamados contra control a 30 dias por segmento,
// cuanto se trabajo y que dicen los clientes. Solo lideres.
export async function medicion ({ today = todayInLima() } = {}) {
  const [rows, estado, resultados] = await Promise.all([
    repo.measurementRows(today, MEASURE_WINDOW_DAYS),
    repo.measurementStatus(today, MEASURE_WINDOW_DAYS),
    repo.outcomesSince(addDays(today, -90))
  ])
  return { today, ventana_dias: MEASURE_WINDOW_DAYS, segmentos: buildMeasurement(rows), estado, resultados }
}
