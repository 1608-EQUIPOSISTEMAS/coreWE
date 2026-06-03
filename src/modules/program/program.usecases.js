import { programRepository } from './program.repository.js'
import {
  normalizeActive,
  normalizeActiveForCaller,
  sliceCharacter,
  buildProgramPayload
} from './program.entity.js'
import {
  toRegisterDto,
  toUpdateDto,
  toPagedDto,
  toVersionCallerDto,
  toPriceListDto,
  toPriceUpdateDto
} from './program.dto.js'

const repo = programRepository

export async function registerProgram ({ program = {}, user_id = null } = {}) {
  const rows = await repo.register(buildProgramPayload(program, user_id))
  return toRegisterDto(rows?.[0] || {})
}

export async function listPrograms (payload = {}) {
  const {
    active = null,
    cat_type_program = null,
    cat_category = null,
    cat_model_modality = null,
    q = null,
    page = 1,
    size = 25
  } = payload

  const rows = await repo.list({
    activeParam: normalizeActive(active),
    cat_type_program,
    cat_category,
    cat_model_modality,
    q,
    page,
    size
  })

  return toPagedDto({ rows, page, size })
}

export async function getProgram ({ id }) {
  const rows = await repo.get(id)
  return { data: rows?.[0] || {} }
}

export async function updateProgram ({ id, program = {}, user_id = null }) {
  const rows = await repo.update(id, buildProgramPayload(program, user_id))
  return toUpdateDto(rows?.[0] || {}, id)
}

export async function callerProgramVersions (payload = {}) {
  const {
    cat_model_modality = null,
    active = null,
    not_modality = null,
    cat_type_program = null,
    q = null
  } = payload

  const rows = await repo.versionCaller({
    active,
    not_modality,
    cat_model_modality,
    cat_type_program,
    q
  })

  return toVersionCallerDto(rows)
}

export async function getProgramVersionDetail ({ program_version_id }) {
  const rows = await repo.versionDetailGet(program_version_id)
  return { data: rows?.[0] || {} }
}

export async function listProgramVersions (payload = {}) {
  const {
    program_id = null,
    program_version_id = null,
    active = null,
    q = null,
    cat_type_program = null,
    cat_category = null,
    cat_model_modality = null,
    page = 1,
    size = 25
  } = payload

  const rows = await repo.versionList({
    program_id,
    activeParam: normalizeActive(active),
    q,
    cat_type_program,
    cat_category,
    cat_model_modality,
    program_version_id,
    page,
    size
  })

  return toPagedDto({ rows, page, size })
}

export async function listPrices (payload = {}) {
  const { character = null } = payload
  const rows = await repo.priceList(sliceCharacter(character))
  return toPriceListDto(rows)
}

export async function callerPrograms (payload = {}) {
  const {
    q = null,
    cat_type_program = null,
    active = 'Y'
  } = payload

  return repo.caller({
    q,
    cat_type_program,
    activeParam: normalizeActiveForCaller(active)
  })
}

export async function updatePrice (payload = {}) {
  const {
    program_version_id,
    price_student_soles,
    price_student_dollars,
    price_professional_soles,
    price_professional_dollars,
    active,
    price_list_id = 1,
    user_id = 1
  } = payload

  const rows = await repo.priceUpdate({
    program_version_id,
    price_student_soles,
    price_student_dollars,
    price_professional_soles,
    price_professional_dollars,
    active,
    price_list_id,
    user_id
  })

  return toPriceUpdateDto(rows?.[0] || {})
}
