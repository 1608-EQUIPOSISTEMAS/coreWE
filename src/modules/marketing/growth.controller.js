import * as usecases from './growth.usecases.js'
import { snapshotFollowersNow } from '../../services/follower-snapshot.js'

// GET /marketing/social-accounts
export async function listSocialAccountsHandler (req, reply) {
  return reply.send({ ok: true, data: await usecases.listAccounts() })
}

// GET /marketing/social-growth?from=YYYY-MM-DD&to=YYYY-MM-DD&brand=
export async function listSocialGrowthHandler (req, reply) {
  const { from, to, brand } = req.query
  return reply.send({ ok: true, data: await usecases.getGrowth({ from, to, brand }) })
}

// GET /marketing/social-goals?year=YYYY
export async function listSocialGoalsHandler (req, reply) {
  return reply.send({ ok: true, data: await usecases.listBrandGoals(req.query.year) })
}

// PUT /marketing/social-goals — fija el objetivo anual de una marca
export async function saveSocialGoalHandler (req, reply) {
  const updatedBy = req.user?.username || req.user?.email || req.user?.sub || null
  return reply.send({ ok: true, data: await usecases.saveBrandGoal(req.body, updatedBy) })
}

// PUT /marketing/social-growth — carga manual de una cuenta sin API
export async function saveSocialGrowthHandler (req, reply) {
  const capturedBy = req.user?.username || req.user?.email || req.user?.sub || null
  return reply.send({ ok: true, data: await usecases.saveManualSnapshot(req.body, capturedBy) })
}

// POST /marketing/social-growth/sync — captura manual inmediata
export async function syncSocialGrowthHandler (req, reply) {
  return reply.send({ ok: true, data: await snapshotFollowersNow('manual') })
}
