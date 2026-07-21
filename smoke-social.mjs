// Smoke test temporal del módulo Publicaciones RRSS (se borra tras validar).
process.env.SOCIAL_SYNC_DISABLED = 'true'
process.env.FICO_MV_REFRESH_DISABLED = 'true'

const { buildApp } = await import('./src/buildApp.js')
const app = await buildApp()
const r1 = await app.inject({ method: 'GET', url: '/api/marketing/social-posts?month=2026-07' })
console.log('GET sin token ->', r1.statusCode, '(se espera 401)')
await app.close()

const repo = await import('./src/modules/marketing/social.repository.js')
const { pool } = await import('./src/config/db.js')

const { post_id } = await repo.createPost({ network: 'IG', account_name: 'we.educacion', caption: 'Test programado', scheduled_at: '2026-07-20T23:00:00Z', status: 'PROGRAMADO', created_by: 'smoke-test' })
console.log('creado post_id', post_id)

let r = await repo.upsertDetected({ network: 'IG', account_name: 'we.educacion', external_id: 'ig_test_match', caption: 'Test programado', permalink: 'https://x', media_type: 'IMAGE', published_at: '2026-07-20T23:07:00Z' })
console.log('detectado cercano ->', r, '(se espera match)')

r = await repo.upsertDetected({ network: 'IG', external_id: 'ig_test_match', published_at: '2026-07-20T23:07:00Z' })
console.log('re-sync ->', r, '(se espera existente)')

r = await repo.upsertDetected({ network: 'IG', account_name: 'we.educacion', external_id: 'ig_test_nuevo', caption: 'Sorpresa sin programar', published_at: '2026-07-10T15:00:00Z' })
console.log('detectado sin programacion ->', r, '(se espera nuevo)')

const rows = await repo.listPosts({ monthStart: '2026-07-01' })
const mine = rows.filter(x => (x.external_id || '').startsWith('ig_test') || x.created_by === 'smoke-test')
console.log(JSON.stringify(mine.map(x => ({ id: x.post_id, status: x.status, source: x.source, ext: x.external_id }))))

await pool.query("DELETE FROM social_posts WHERE external_id LIKE 'ig_test%' OR created_by = 'smoke-test'")
console.log('limpieza OK')
await pool.end()
process.exit(0)
