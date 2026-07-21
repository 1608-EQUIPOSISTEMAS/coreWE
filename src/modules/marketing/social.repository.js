import { pool } from '../../config/db.js'

// Publicaciones del mes (por fecha efectiva: publicada o, si no, programada).
export async function listPosts ({ monthStart, network, status }) {
  const conds = [`p.active = 'Y'`,
    `COALESCE(p.published_at, p.scheduled_at) >= $1::date`,
    `COALESCE(p.published_at, p.scheduled_at) < ($1::date + INTERVAL '1 month')`]
  const params = [monthStart]
  if (network) { params.push(network); conds.push(`p.network = $${params.length}`) }
  if (status) { params.push(status); conds.push(`p.status = $${params.length}`) }
  const { rows } = await pool.query(`
    SELECT p.post_id, p.network, p.account_name, p.external_id, p.caption, p.permalink,
           p.media_type, p.scheduled_at, p.published_at, p.status, p.source,
           p.confirmed, p.notes, p.created_by, p.created_at
    FROM social_posts p
    WHERE ${conds.join(' AND ')}
    ORDER BY COALESCE(p.published_at, p.scheduled_at) DESC
  `, params)
  return rows
}

export async function createPost (d) {
  const { rows } = await pool.query(`
    INSERT INTO social_posts
      (network, account_name, caption, permalink, scheduled_at, published_at,
       status, source, confirmed, notes, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING post_id
  `, [d.network, d.account_name || null, d.caption || null, d.permalink || null,
    d.scheduled_at || null, d.published_at || null, d.status, d.source || 'MANUAL',
    d.confirmed || 'N', d.notes || null, d.created_by || null])
  return rows[0]
}

const UPDATABLE = ['account_name', 'caption', 'permalink', 'scheduled_at',
  'published_at', 'status', 'confirmed', 'notes']

export async function updatePost (postId, patch) {
  const sets = []
  const params = []
  for (const k of UPDATABLE) {
    if (k in patch) { params.push(patch[k]); sets.push(`${k} = $${params.length}`) }
  }
  if (!sets.length) return
  params.push(postId)
  await pool.query(
    `UPDATE social_posts SET ${sets.join(', ')}, updated_at = now() WHERE post_id = $${params.length}`,
    params)
}

export async function deactivatePost (postId) {
  await pool.query(`UPDATE social_posts SET active = 'N', updated_at = now() WHERE post_id = $1`, [postId])
}

// ── Sync automático ──────────────────────────────────────────
// Registra un post detectado en la API. Idempotente por external_id.
//  1. Ya existe por external_id -> nada.
//  2. Hay una programación pendiente de la misma red a ±3h -> match: pasa a PUBLICADO.
//  3. No hay match -> se inserta como NO_PROGRAMADO (el hueco que no se registraba).
// ponytail: match solo por cercanía horaria; si genera falsos positivos,
// comparar también similitud de caption.
export async function upsertDetected (d) {
  const dup = await pool.query(
    `SELECT 1 FROM social_posts WHERE external_id = $1`, [d.external_id])
  if (dup.rowCount) return 'existente'

  const cand = await pool.query(`
    SELECT post_id FROM social_posts
    WHERE active = 'Y' AND status = 'PROGRAMADO' AND external_id IS NULL
      AND network = $1
      AND ABS(EXTRACT(EPOCH FROM (scheduled_at - $2::timestamptz))) <= 3 * 3600
    ORDER BY ABS(EXTRACT(EPOCH FROM (scheduled_at - $2::timestamptz)))
    LIMIT 1
  `, [d.network, d.published_at])

  if (cand.rowCount) {
    await pool.query(`
      UPDATE social_posts
      SET status = 'PUBLICADO', external_id = $2, published_at = $3,
          permalink = COALESCE($4, permalink), media_type = $5,
          account_name = COALESCE(account_name, $6),
          caption = COALESCE(NULLIF(caption, ''), $7), updated_at = now()
      WHERE post_id = $1
    `, [cand.rows[0].post_id, d.external_id, d.published_at, d.permalink || null,
      d.media_type || null, d.account_name || null, d.caption || null])
    return 'match'
  }

  await pool.query(`
    INSERT INTO social_posts
      (network, account_name, external_id, caption, permalink, media_type,
       published_at, status, source)
    VALUES ($1,$2,$3,$4,$5,$6,$7,'NO_PROGRAMADO','AUTO')
    ON CONFLICT (external_id) DO NOTHING
  `, [d.network, d.account_name || null, d.external_id, d.caption || null,
    d.permalink || null, d.media_type || null, d.published_at])
  return 'nuevo'
}
