import * as usecases from './reconciliation.usecases.js'

// Adapter HTTP delgado: los errores los normaliza el handler global (DomainError).

export async function reconcileSheetHandler (req, reply) {
  const data = await usecases.reconcileFicoSheets({ urls: req.body.urls })
  return reply.code(200).send({ ok: true, data })
}
