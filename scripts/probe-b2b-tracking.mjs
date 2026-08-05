// Sondeo del Seguimiento B2B: levanta la app Fastify en memoria y golpea los
// dos endpoints nuevos (valida rutas + JSON schema + tamano del payload).
import 'dotenv/config'
import { buildApp } from '../src/buildApp.js'

const app = await buildApp()
await app.ready()
console.log('rutas:\n' + app.printRoutes({ commonPrefix: false }).split('\n').filter(l => l.includes('b2b')).join('\n'))

const auth = { authorization: `Bearer ${app.jwt.sign({ user_id: 1, roles: ['ADMIN'] })}` }

for (const scope of ['curso', 'todas']) {
  const t0 = process.hrtime.bigint()
  const res = await app.inject({ method: 'POST', url: '/api/edition/b2btrackinglist', headers: auth, payload: { scope } })
  const ms = Number(process.hrtime.bigint() - t0) / 1e6
  const d = res.json().data || []
  console.log(`\nscope=${scope} -> ${res.statusCode} | aulas ${d.length} | alumnos ${d.reduce((a, e) => a + e.students.length, 0)}` +
    ` | ${(res.rawPayload.length / 1024).toFixed(0)} KB | ${ms.toFixed(0)} ms`)
  // La vista exige estos campos; si el backend deja de mandarlos, revienta aqui.
  const e = d[0]
  const faltan = ['edition_num_id', 'abbreviation', 'specific_code', 'version_code', 'instructor',
    'day_label', 'hour_label', 'start_date', 'end_date', 'total_sessions', 'sessions', 'students']
    .filter(k => !(k in e))
  const faltanAl = ['enrollment_id', 'dni', 'full_name', 'email', 'phone', 'final_grade', 'attendance', 'summary']
    .filter(k => !(k in e.students[0]))
  console.log(`  contrato aula ${faltan.length ? 'FALTA ' + faltan : 'ok'} | alumno ${faltanAl.length ? 'FALTA ' + faltanAl : 'ok'}` +
    ` | sesiones con fecha: ${e.sessions.every(s => s.date)}`)
}

const bad = await app.inject({ method: 'POST', url: '/api/edition/b2battendancesave', headers: auth, payload: { enrollment_id: 1, program_edition_id: 1, session_number: 1, status: 'Z' } })
const noSes = await app.inject({ method: 'POST', url: '/api/edition/b2battendancesave', headers: auth, payload: { enrollment_id: 1, program_edition_id: 1 } })
const noTok = await app.inject({ method: 'POST', url: '/api/edition/b2btrackinglist', payload: {} })
console.log(`\nstatus invalido ${bad.statusCode} (400) | sin session_number ${noSes.statusCode} (400) | sin token ${noTok.statusCode} (401)`)

await app.close()
process.exit(0)
