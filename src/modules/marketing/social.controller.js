import * as repo from './social.repository.js'
import { syncSocialNow } from '../../services/social-sync.cron.js'

const NETWORKS = ['IG', 'LINKEDIN']
const STATUSES = ['PROGRAMADO', 'PUBLICADO', 'NO_PROGRAMADO', 'CANCELADO']

// GET /marketing/social-posts?month=YYYY-MM&network=&status=
export async function listSocialPostsHandler (req, reply) {
  const month = /^\d{4}-\d{2}$/.test(req.query?.month || '') ? req.query.month : null
  if (!month) return reply.code(400).send({ ok: false, error: 'month requerido (YYYY-MM)' })
  const network = NETWORKS.includes(req.query?.network) ? req.query.network : null
  const status = STATUSES.includes(req.query?.status) ? req.query.status : null
  const rows = await repo.listPosts({ monthStart: `${month}-01`, network, status })
  return reply.send({ ok: true, data: rows })
}

// POST /marketing/social-posts
// Programar (scheduled_at, sin published_at) o registrar una ya publicada
// (published_at; queda NO_PROGRAMADO salvo que traiga también scheduled_at).
export async function createSocialPostHandler (req, reply) {
  const b = req.body || {}
  if (!NETWORKS.includes(b.network)) return reply.code(400).send({ ok: false, error: 'network debe ser IG o LINKEDIN' })
  if (!b.scheduled_at && !b.published_at) return reply.code(400).send({ ok: false, error: 'se requiere scheduled_at o published_at' })

  const status = b.published_at
    ? (b.scheduled_at ? 'PUBLICADO' : 'NO_PROGRAMADO')
    : 'PROGRAMADO'
  const row = await repo.createPost({
    ...b,
    status,
    source: 'MANUAL',
    confirmed: b.published_at ? 'Y' : 'N',
    created_by: req.user?.username || req.user?.email || req.user?.sub || null
  })
  return reply.send({ ok: true, data: row })
}

// PUT /marketing/social-posts/:id  (editar, confirmar, marcar publicada, cancelar)
export async function updateSocialPostHandler (req, reply) {
  const id = Number(req.params.id)
  if (!id) return reply.code(400).send({ ok: false, error: 'id inválido' })
  const patch = { ...req.body }
  if ('status' in patch && !STATUSES.includes(patch.status)) {
    return reply.code(400).send({ ok: false, error: 'status inválido' })
  }
  delete patch.network; delete patch.external_id; delete patch.source
  await repo.updatePost(id, patch)
  return reply.send({ ok: true })
}

// DELETE /marketing/social-posts/:id (soft delete)
export async function deleteSocialPostHandler (req, reply) {
  const id = Number(req.params.id)
  if (!id) return reply.code(400).send({ ok: false, error: 'id inválido' })
  await repo.deactivatePost(id)
  return reply.send({ ok: true })
}

// POST /marketing/social-posts/sync — sincronización manual inmediata
export async function syncSocialPostsHandler (req, reply) {
  const counts = await syncSocialNow('manual')
  return reply.send({ ok: true, data: counts })
}
