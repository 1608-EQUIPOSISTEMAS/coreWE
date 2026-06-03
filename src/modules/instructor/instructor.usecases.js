import { DomainError } from '../../shared/errors.js'
import { odoo } from '../../shared/adapters/odoo/odoo.adapter.js'
import { slack } from '../../shared/adapters/slack/slack.adapter.js'
import { instructorRepository } from './instructor.repository.js'
import { buildTempPassword, buildFullName, normalizeActive, normalizeActiveForCaller } from './instructor.entity.js'
import { toListDto, toRegisterDto, toUpdateDto } from './instructor.dto.js'

const repo = instructorRepository

export async function registerInstructor ({ instructor = {} } = {}) {
  const row = await repo.register(instructor)
  if (!row.instructor_id) throw new DomainError('sp_instructor_register no devolvio instructor_id')

  const password = buildTempPassword(instructor.document_number)
  const fullName = buildFullName(instructor)

  const odooResult = await odoo.syncInstructorToOdoo({
    login: instructor.email ?? null,
    name: fullName || null,
    password,
    linkedin: instructor.linkedin ?? null,
    internalNotes: instructor.profile_resume ?? null,
    parentId: instructor.odoo_parent_id ?? null
  })

  if (odooResult.odoo_user_id && odooResult.odoo_partner_id) {
    await repo.setOdoo(row.instructor_id, odooResult.odoo_user_id, odooResult.odoo_partner_id)
  }
  if (odooResult.odoo_error) {
    console.warn(`[instructor] Odoo sync fallo para instructor ${row.instructor_id}: ${odooResult.odoo_error}`)
  }

  await slack.notifyInstructorCredentials({
    fullName,
    email: instructor.email ?? null,
    password,
    instructorId: row.instructor_id
  })

  return toRegisterDto({ row, odoo: odooResult })
}

export async function listInstructors (payload = {}) {
  const { active = null, cat_occupation = null, cat_person_status = null, q = null, page = 1, size = 25 } = payload
  const rows = await repo.list({
    activeParam: normalizeActive(active),
    cat_occupation, cat_person_status, q, page, size
  })
  return toListDto({ rows, page, size })
}

export async function getInstructor ({ id }) {
  return { data: await repo.get(id) }
}

export async function updateInstructor ({ id, instructor = {} }) {
  const row = await repo.update(id, instructor)
  return toUpdateDto({ row, id })
}

export async function callerInstructors (payload = {}) {
  const { active = 'Y', cat_occupation = null, cat_person_status = null, q = null } = payload
  return repo.caller({
    activeParam: normalizeActiveForCaller(active),
    cat_occupation, cat_person_status, q
  })
}
