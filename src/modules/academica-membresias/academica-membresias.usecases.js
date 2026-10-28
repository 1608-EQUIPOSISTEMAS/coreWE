import { membershipRepository } from '../fico/membership/membership.repository.js'
import { buildMembershipExpiries } from '../fico/membership/membership.entity.js'
import { MEMBERSHIP_REGISTRATION_START_SQL } from '../../utils/membership-start.sql.js'
import { DomainError, NotFoundError } from '../../shared/errors.js'
import { currentMembers, checkpointsFor, withChecks } from './academica-membresias.entity.js'
import { listChecks, markCheck, unmarkCheck } from './academica-membresias.repository.js'

// Mismo universo y misma agrupacion por socio que Vencimientos de FICO; solo
// cambia el arranque (fecha de registro) y se quedan fuera las vencidas.
// ponytail: reusa el repository de fico/membership en vez de duplicar la query.
async function loadCurrentMembers () {
  const rows = await membershipRepository.listMembershipStarts(MEMBERSHIP_REGISTRATION_START_SQL)
  return currentMembers(buildMembershipExpiries(rows, rows[0]?.today))
}

export async function listCurrentMembers () {
  const [members, checks] = await Promise.all([loadCurrentMembers(), listChecks()])
  return { ...members, items: withChecks(members.items, checks) }
}

// La etapa la decide el hoy del servidor, no la pantalla: una pestaña abierta
// desde ayer no puede marcar S1 a un socio que ya paso a seguimiento. El tier
// tambien: un Plus no tiene S2 aunque la pantalla lo mande.
export async function setCheck ({ enrollmentId, checkpoint, checked }, userId) {
  const { items } = await loadCurrentMembers()
  const member = items.find(i => i.enrollment_id === enrollmentId)
  if (!member) throw new NotFoundError('La membresía no está vigente')
  if (!checkpointsFor(member.status, member.tier).includes(checkpoint)) {
    throw new DomainError(`${checkpoint} no corresponde a la etapa actual del socio`, { statusCode: 409 })
  }
  if (checked) await markCheck(enrollmentId, checkpoint, userId)
  else await unmarkCheck(enrollmentId, checkpoint)
}
