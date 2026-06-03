import * as usecases from './validation.usecases.js'
import { toValidationsDto, toSaveResultDto, toProgramChildrenDto } from './validation.dto.js'

// Adapters HTTP delgados: leen req, delegan al usecase, responden. Sin try/catch
// (el error handler global de buildApp normaliza DomainError). Se preservan
// status, shape de respuesta { ok, data } y el parseo de params del legacy.

export async function getProgramChildrenHandler (req, reply) {
  const parentEditionId = req.query?.parent_edition_id ? parseInt(req.query.parent_edition_id) : null
  const data = await usecases.getProgramChildren({
    programVersionId: parseInt(req.params.id),
    parentEditionId
  })
  return reply.code(200).send({ ok: true, data: toProgramChildrenDto(data) })
}

export async function getValidationsHandler (req, reply) {
  const data = await usecases.getValidations({ enrollmentId: parseInt(req.params.enrollmentId) })
  return reply.code(200).send({ ok: true, data: toValidationsDto(data) })
}

export async function saveValidationsHandler (req, reply) {
  const data = await usecases.saveValidations({
    enrollmentId: req.body.enrollment_id,
    validations: req.body.validations,
    userId: req.user?.id ?? req.body.user_id
  })
  return reply.code(200).send({ ok: true, data: toSaveResultDto(data) })
}
