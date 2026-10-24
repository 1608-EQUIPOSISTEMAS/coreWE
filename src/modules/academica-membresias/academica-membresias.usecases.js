import { membershipRepository } from '../fico/membership/membership.repository.js'
import { buildMembershipExpiries } from '../fico/membership/membership.entity.js'
import { MEMBERSHIP_REGISTRATION_START_SQL } from '../../utils/membership-start.sql.js'
import { currentMembers } from './academica-membresias.entity.js'

// Mismo universo y misma agrupacion por socio que Vencimientos de FICO; solo
// cambia el arranque (fecha de registro) y se quedan fuera las vencidas.
// ponytail: reusa el repository de fico/membership en vez de duplicar la query.
export async function listCurrentMembers () {
  const rows = await membershipRepository.listMembershipStarts(MEMBERSHIP_REGISTRATION_START_SQL)
  return currentMembers(buildMembershipExpiries(rows, rows[0]?.today))
}
