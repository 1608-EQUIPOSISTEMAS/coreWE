import * as teams from './teams-meetings.usecases.js'

// Arranca la sincronizacion en segundo plano; el avance va por /teams/syncstatus.
export async function teamsSyncStartHandler (req, reply) {
  const { edition_ids: editionIds = null, dry_run: dryRun = false } = req.body || {}
  return reply.code(202).send({ ok: true, data: teams.startTeamsSync({ editionIds, dryRun }) })
}

export async function teamsSyncStatusHandler (req, reply) {
  return reply.code(200).send({ ok: true, data: teams.teamsSyncStatus(req.body.job_id) })
}

export async function teamsSummaryHandler (req, reply) {
  return reply.code(200).send({ ok: true, data: await teams.teamsSummary() })
}

export async function teamsEditionLinksHandler (req, reply) {
  return reply.code(200).send({ ok: true, data: await teams.editionTeamsLinks(req.body.edition_num_id) })
}
