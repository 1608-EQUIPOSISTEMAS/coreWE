import { withTransaction } from '../../shared/db/pool.js'
import { DomainError, ForbiddenError, NotFoundError } from '../../shared/errors.js'
import { bandejaRepository as repo } from './bandeja.repository.js'
import { prediccionRepository } from './prediccion.repository.js'
import { offerContext } from './prediccion.entity.js'
import { rankCandidates, distributeSnake, controlWithinReach, addDays, isControl, LOCK_DAYS, OUTCOMES, NO_BUY_REASONS } from './bandeja.entity.js'
import { buildMeasurement, MEASURE_WINDOW_DAYS } from './medicion.entity.js'

// Hoy en Lima: el servidor corre en UTC y a las 19:00 de Lima ya seria manana.
const todayInLima = () => new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10)

// Un lider ve y opera la bandeja de cualquier asesor; el asesor, solo la suya.
const LEADER_ROLES = ['ADMIN', 'LIDER_COMERCIAL', 'GERENCIA']
const isLeader = (requester) => LEADER_ROLES.some((r) => requester.roles?.includes(r))

// Cualquier numero fijo sirve mientras sea el mismo en todos los procesos.
const GENERATION_LOCK_KEY = 72_017_015

// Cierra lo comprado y lo vencido, y reparte a los clientes que volvieron a
// consultar entre los asesores con espacio. Idempotente en el dia: correrla dos
// veces solo rellena hasta el tope.
export async function generarBandeja ({ today = todayInLima() } = {}) {
  return withTransaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock($1)', [GENERATION_LOCK_KEY])
    const compraron = await repo.closePurchased(db, today)
    const vencidos = await repo.expireOverdue(db, today)
    const ranked = rankCandidates(await repo.candidates(db, today))
    // El control se sortea ANTES del reparto (fijo por telefono) y se recorta al
    // mismo rango del ranking que alcanzo el cupo: asi se compara lo comparable.
    const advisors = await repo.advisorsWithLoad(db)
    const assignments = distributeSnake({ ranked: ranked.filter((c) => !isControl(c.phone_key)), advisors })
    const control = controlWithinReach({ control: ranked.filter((c) => isControl(c.phone_key)), assigned: assignments })
      .map((c) => ({ ...c, is_control: true, user_id: null }))
    const period = { today, expiresOn: addDays(today, LOCK_DAYS) }
    const asignados = await repo.insertAssignments(db, assignments, period)
    const enControl = await repo.insertAssignments(db, control, period)
    return { today, compraron, vencidos, candidatos: ranked.length, asesores: advisors.length, asignados, control: enControl }
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
    compraron: by.COMPRO ?? 0,
    // Suma de probabilidades = cuantas compras se esperaban de esos clientes.
    compras_esperadas: Math.round(closed.reduce((s, r) => s + r.expected_pct, 0)) / 100,
    vencidos: by.VENCIDO ?? 0
  }
}

export async function bandejaDe ({ userId, requester, today = todayInLima() }) {
  const owner = resolveOwner({ userId, requester })
  const [abiertos, closed, asesores] = await Promise.all([
    repo.openAssignmentsOf(owner),
    repo.closedSince(owner, addDays(today, -30)),
    isLeader(requester) ? repo.advisorsWithLoad() : Promise.resolve([])
  ])
  // Fecha y precio de lo que consulto: el mismo "plus" que la ficha, para que el
  // asesor mande la propuesta desde la bandeja sin abrir nada mas.
  const programIds = [...new Set(abiertos.map((a) => a.program_id).filter(Boolean))]
  const details = new Map((await prediccionRepository.offerDetails(programIds, today)).map((d) => [d.program_id, d]))
  return {
    user_id: owner,
    today,
    abiertos: abiertos.map((a) => ({ ...a, ...offerContext(details.get(a.program_id)) })),
    ultimos_30_dias: resumenDesde(closed),
    asesores
  }
}

export async function registrarResultado ({ assignmentId, outcome, reason = null, requester }) {
  if (!OUTCOMES.includes(outcome)) throw new DomainError(`Resultado no válido: ${outcome}`)
  if (reason && !NO_BUY_REASONS.includes(reason)) throw new DomainError(`Motivo no válido: ${reason}`)
  if (outcome === 'NO_INTERESA' && !reason) throw new DomainError('Elige por qué no le interesa: es lo que dice cuándo volver a llamarlo.')
  if (reason && !['NO_INTERESA', 'CONTESTO'].includes(outcome)) throw new DomainError('El motivo solo aplica si contestó.')
  const assignment = await repo.assignmentById(assignmentId)
  if (!assignment) throw new NotFoundError('Ese cliente ya no está en la bandeja.')
  if (assignment.user_id !== requester.id && !isLeader(requester)) {
    throw new ForbiddenError('Ese cliente está asignado a otro asesor.')
  }
  const saved = await repo.saveOutcome({ assignmentId, outcome, reason, userId: requester.id })
  if (!saved) throw new DomainError('Ese cliente ya tenía un resultado registrado o se cerró solo (compró o venció).', { statusCode: 409 })
  return { assignment_id: assignmentId, outcome, reason }
}

// ¿La bandeja hace vender mas? Llamados contra control a 30 dias por segmento,
// cuanto se trabajo y por que no compran. Solo lideres.
export async function medicion ({ today = todayInLima() } = {}) {
  const [rows, estado, motivos] = await Promise.all([
    repo.measurementRows(today, MEASURE_WINDOW_DAYS),
    repo.measurementStatus(today, MEASURE_WINDOW_DAYS),
    repo.noBuyReasons(addDays(today, -90))
  ])
  return { today, ventana_dias: MEASURE_WINDOW_DAYS, segmentos: buildMeasurement(rows), estado, motivos }
}
