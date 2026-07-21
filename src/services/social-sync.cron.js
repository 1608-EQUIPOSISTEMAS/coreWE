// Sync de publicaciones RRSS (Instagram + LinkedIn) contra social_posts.
//
// Cada 15 min consulta las APIs oficiales y registra lo publicado:
// matchea contra programaciones pendientes o inserta como NO_PROGRAMADO
// (ver social.repository.upsertDetected).
//
// Credenciales por .env — si faltan, la red se salta con un log (el módulo
// funciona igual en modo manual):
//   IG_USER_ID / IG_ACCESS_TOKEN          -> Instagram Graph API (cuenta Business)
//   LINKEDIN_ACCESS_TOKEN / LINKEDIN_ORGS -> Community Management API.
//     LINKEDIN_ORGS = "12345:WE Educación Ejecutiva,67890:WE For Business"
//
// Set SOCIAL_SYNC_DISABLED=true para apagarlo.

import cron from 'node-cron'
import { upsertDetected } from '../modules/marketing/social.repository.js'

const SCHEDULE = '*/15 * * * *'
let _running = false

async function syncInstagram (counts) {
  const { IG_USER_ID, IG_ACCESS_TOKEN } = process.env
  if (!IG_USER_ID || !IG_ACCESS_TOKEN) { counts.ig_skip = 'sin credenciales'; return }
  const url = `https://graph.facebook.com/v21.0/${IG_USER_ID}/media` +
    `?fields=id,caption,permalink,media_type,timestamp,username&limit=25` +
    `&access_token=${IG_ACCESS_TOKEN}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`IG ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const { data = [] } = await res.json()
  for (const m of data) {
    const r = await upsertDetected({
      network: 'IG',
      account_name: m.username || null,
      external_id: `ig_${m.id}`,
      caption: m.caption || null,
      permalink: m.permalink || null,
      media_type: m.media_type || null,
      published_at: m.timestamp
    })
    counts[r] = (counts[r] || 0) + 1
  }
}

async function syncLinkedIn (counts) {
  const { LINKEDIN_ACCESS_TOKEN, LINKEDIN_ORGS } = process.env
  if (!LINKEDIN_ACCESS_TOKEN || !LINKEDIN_ORGS) { counts.li_skip = 'sin credenciales'; return }
  const orgs = LINKEDIN_ORGS.split(',').map(s => {
    const [id, ...name] = s.split(':')
    return { id: id.trim(), name: name.join(':').trim() }
  })
  for (const org of orgs) {
    const author = encodeURIComponent(`urn:li:organization:${org.id}`)
    const res = await fetch(
      `https://api.linkedin.com/rest/posts?author=${author}&q=author&count=25&sortBy=LAST_MODIFIED`,
      {
        headers: {
          Authorization: `Bearer ${LINKEDIN_ACCESS_TOKEN}`,
          'LinkedIn-Version': '202506',
          'X-Restli-Protocol-Version': '2.0.0'
        }
      })
    if (!res.ok) throw new Error(`LinkedIn ${res.status} (org ${org.id}): ${(await res.text()).slice(0, 200)}`)
    const { elements = [] } = await res.json()
    for (const p of elements) {
      if (p.lifecycleState && p.lifecycleState !== 'PUBLISHED') continue
      const r = await upsertDetected({
        network: 'LINKEDIN',
        account_name: org.name || `org ${org.id}`,
        external_id: p.id,
        caption: p.commentary || null,
        permalink: `https://www.linkedin.com/feed/update/${p.id}`,
        media_type: null,
        published_at: new Date(p.publishedAt || p.createdAt).toISOString()
      })
      counts[r] = (counts[r] || 0) + 1
    }
  }
}

// Esperable: la usa el cron y el botón "Sincronizar" del módulo.
export async function syncSocialNow (source = 'cron') {
  if (_running) return { running: true }
  _running = true
  const counts = {}
  try {
    // Cada red falla por separado: un token vencido de IG no debe frenar LinkedIn.
    try { await syncInstagram(counts) } catch (e) { counts.ig_error = e.message; console.error('[social-sync] IG:', e.message) }
    try { await syncLinkedIn(counts) } catch (e) { counts.li_error = e.message; console.error('[social-sync] LinkedIn:', e.message) }
    console.log(`[social-sync] (${source})`, JSON.stringify(counts))
    return counts
  } finally {
    _running = false
  }
}

if (process.env.SOCIAL_SYNC_DISABLED === 'true') {
  console.log('[social-sync] DESHABILITADO via SOCIAL_SYNC_DISABLED=true')
} else {
  cron.schedule(SCHEDULE, () => syncSocialNow('cron'), { timezone: 'America/Lima' })
  console.log('[social-sync] Programado cada 15 min (TZ America/Lima)')
}
