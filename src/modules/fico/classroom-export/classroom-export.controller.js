import * as usecases from './classroom-export.usecases.js'

// Adapters HTTP delgados de la exportacion del aula. Sin try/catch: los errores
// los normaliza el error handler global de buildApp.

export async function optionsHandler (req, reply) {
  const data = await usecases.getClassroomExportOptions()
  return reply.code(200).send({ ok: true, data })
}

export async function exportHandler (req, reply) {
  const programVersionId = Number(req.query.programVersionId)
  const editionNumId = Number(req.query.editionNumId)
  const csv = await usecases.exportClassroomCsv({ programVersionId, editionNumId })
  const filename = `aula_${req.query.programVersionId}_${req.query.editionNumId}.csv`
  return reply
    .code(200)
    .header('Content-Type', 'text/csv; charset=utf-8')
    .header('Content-Disposition', `attachment; filename="${filename}"`)
    .send(csv)
}
