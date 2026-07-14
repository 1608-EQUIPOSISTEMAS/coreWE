import * as usecases from './integration.usecases.js'
import { mapSlackReportPayload } from './integration.dto.js'

export async function syncLeadsToSheetHandler (req, reply) {
  const data = await usecases.syncLeadsToSheet(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function syncInscToSheetHandler (req, reply) {
  const data = await usecases.syncInscToSheet(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function syncScheduleToSheetHandler (req, reply) {
  const data = await usecases.syncScheduleToSheet(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function syncRprospectosHandler (req, reply) {
  const data = await usecases.syncRprospectos()
  return reply.code(200).send({ ok: true, data })
}

export async function syncEnrollmentToSheetHandler (req, reply) {
  const data = await usecases.syncEnrollmentToSheet()
  return reply.code(200).send({ ok: true, data })
}

export async function syncFicoSalesToSheetHandler (req, reply) {
  const data = await usecases.syncFicoSalesToSheet()
  return reply.code(200).send({ ok: true, data })
}

export async function syncFicoToSheetsHandler (req, reply) {
  const data = usecases.startFicoSyncInBackground()
  return reply.code(202).send({ ok: true, data })
}

export async function ficoSyncStatusHandler (req, reply) {
  return reply.code(200).send({ ok: true, data: usecases.getFicoSyncStatus() })
}

export async function sendSlackReportHandler (req, reply) {
  const data = await usecases.sendReportToSlack(mapSlackReportPayload(req.body))
  return reply.code(200).send({ ok: true, data })
}
