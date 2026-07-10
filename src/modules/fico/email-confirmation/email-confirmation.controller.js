import * as usecases from './email-confirmation.usecases.js'
import { toPreviewDto, toSendResultDto, toEmailLogsDto } from './email-confirmation.dto.js'

// Adapters HTTP delgados: leen req, delegan al usecase, responden. Sin try/catch
// (los throws inesperados los normaliza el error handler global de buildApp). Los
// fallos de negocio del envio NO lanzan: viajan dentro del result object como
// { success:false, error }, igual que el service legacy.

export async function sendConfirmationEmailHandler (req, reply) {
  const result = await usecases.sendConfirmationEmail({
    enrollmentId: req.body.enrollment_id,
    cc: req.body.cc ?? undefined,
    sapUsername: req.body.sap_username ?? null,
    sapPassword: req.body.sap_password ?? null,
    // Borde HTTP manual (FICO): exige credenciales SAP cuando aplica.
    enforceSapCredentials: true
  })
  return reply.code(200).send({ ok: true, data: toSendResultDto(result) })
}

export async function sendPaymentConfirmationEmailHandler (req, reply) {
  const result = await usecases.sendPaymentConfirmationEmail({ enrollmentId: req.body.enrollment_id })
  return reply.code(200).send({ ok: true, data: toSendResultDto(result) })
}

export async function previewEmailHandler (req, reply) {
  const data = await usecases.previewConfirmationEmail({
    enrollmentId: req.body.enrollment_id,
    overrideEditionId: req.body.override_edition_id || null,
    overrideProgramVersionId: req.body.override_program_version_id || null,
    activationDate: req.body.activation_date || null,
    sapUsername: req.body.sap_username ?? null,
    sapPassword: req.body.sap_password ?? null,
    overrideInstallments: req.body.override_installments ?? null
  })
  return reply.code(200).send({ ok: true, data: toPreviewDto(data) })
}

export async function emailLogsHandler (req, reply) {
  const data = await usecases.getEmailLogs({ enrollmentId: req.body.enrollment_id })
  return reply.code(200).send({ ok: true, data: toEmailLogsDto(data) })
}
