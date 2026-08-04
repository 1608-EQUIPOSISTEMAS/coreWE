// Carga inicial del catálogo de cursos de membresía (tabla
// membership_online_courses) desde la lista aprobada por el negocio.
//
// Sin --apply es SOLO LECTURA: consulta Odoo, cruza nombres y muestra el
// reporte de match. Nada toca la BD hasta que se pasa --apply.
//
//   node scripts/seed-membership-courses.mjs            # dry-run (reporte)
//   node scripts/seed-membership-courses.mjs --apply    # escribe la tabla
//
// Requiere ODOO_* en Backend/.env y, para --apply, el túnel SSH arriba
// (127.0.0.1:55432) + PGPASSWORD exportada. Ver scripts/db.mjs.
import 'dotenv/config'
import odooClient from '../src/config/odooClient.js'

// Lista tal cual la pasó el usuario (04/08/2026). Los nombres se comparan
// normalizados (sin tildes, sin mayúsculas, espacios colapsados) porque el
// Campus no es consistente con acentos ni con "&" vs "y".
const LISTA = [
  'Visio',
  'Trazando tu línea de carrera',
  'Entrevista Exitosa',
  'Habilidades Gerenciales Logísticas',
  'Habilidades para el empleo',
  'SAP IN: Módulo Integral (MM+SD+FI+PP) Online',
  'SAP FI: Módulo Financiero Online',
  'Power BI: Aplicativo',
  'SQL Server Intermedio',
  'SQL Server Básico',
  'SQL Server Online',
  'Python',
  'Python Fundamentals',
  'Python for Analytics',
  'Looker Studio',
  'Planeamiento con MS Project',
  'Bizagi Online',
  "Planeamiento estratégico con OKR's",
  'Implementación Lean y Mejora continua',
  'Introducción y Principios Lean',
  'Lean Supply Chain',
  'Planeamiento & Pronóstico de la Demanda Online',
  'Gestión de Compras e Inventarios',
  'Matriz IPERC en Construcción: Implementación y Segui',   // truncado en la fuente
  'Matriz IPERC en Minería: Implementación y Seguimient',   // truncado en la fuente
  'Matriz IPERC: Conceptos Clave e Implementación',
  'ISO 9001:2015: Norma e Implementación',
  'ISO 45001:2018: Norma e Implementación',
  'Excel: Análisis de Datos con Macros',
  'Excel Financiero: Análisis y funciones avanzadas',
  'Excel Financiero: Funciones principales',
  'Excel Financiero Online',
  'Excel Básico Online',
  'Excel Avanzado Online',
  'Excel Intermedio Online',
  'Excel: Formularios con VBA',
  'Excel + Access para grandes Bases de Datos',
  'Tablas Dinámicas con Excel',
  'Design Thinking',
  'Especialista en modelamiento de procesos',
  'Especialista en Visualización de Datos',
  'Especialista en Herramientas Ágiles',
  'Especialización en Empleabilidad',
  'Especialista en VBA Macros',
  'Especialista en SAP',
  'Especialización en Analista de Datos',
  'Especialización en Gestión Financiera',
  'Especialización en Analista de Compras',
  'Especialización en Seguridad e ISO 45001',
  'Especialización en Demand Planner',
  'Especialista en Excel',
  'Tableau Online',
  'Microsoft Word',
  'Excel: Funciones Principales',
  'Power Automate Online',
  'Hostigamiento sexual laboral',
  'Power Point & Storytelling',
  'Programa de Desarrollo Profesional',
  'Fundamentos de Programación',
  'Análisis de datos con Minitab',
  'Programación con R Online',
  'Diseño de página web con Wordpress',
  'SAP S/4 HANA MM Online',
  "Gestión estratégica con OKR's y KPI's",
  'Gestión de Proyectos',
  'Power Apps',
  'UX/UI Fundamentals aplicando Figma',
  'Figma Advanced'
]

const norm = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')   // tildes fuera
  .toLowerCase()
  .replace(/[’'`´]/g, "'")
  .replace(/\s+/g, ' ')
  .trim()

const APPLY = process.argv.includes('--apply')

const channels = await odooClient.listOnlineChannels()
console.log(`Odoo devolvió ${channels.length} canales publicados.\n`)

const byNorm = new Map()
for (const c of channels) {
  const k = norm(c.name)
  if (!byNorm.has(k)) byNorm.set(k, [])
  byNorm.get(k).push(c)
}

const matched = []          // { id, name, via }
const ambiguous = []        // el mismo nombre existe 2+ veces en Odoo
const notFound = []
const seenIds = new Set()

for (const raw of LISTA) {
  const k = norm(raw)
  // 1) exacto  2) prefijo (los dos nombres truncados de la fuente)
  let hits = byNorm.get(k)
  let via = 'exacto'
  if (!hits) {
    hits = channels.filter(c => norm(c.name).startsWith(k))
    via = 'prefijo'
  }
  if (!hits || hits.length === 0) { notFound.push(raw); continue }
  if (hits.length > 1) { ambiguous.push({ raw, hits }); continue }
  const c = hits[0]
  if (seenIds.has(c.id)) continue   // duplicado en la lista de origen
  seenIds.add(c.id)
  matched.push({ id: c.id, name: c.name, via })
}

const extras = channels.filter(c => !seenIds.has(c.id))

console.log(`── MATCH (${matched.length}) ───────────────────────────────`)
for (const m of matched) console.log(`  #${String(m.id).padEnd(5)} ${m.name}${m.via === 'prefijo' ? '   [por prefijo]' : ''}`)

if (ambiguous.length) {
  console.log(`\n── AMBIGUOS (${ambiguous.length}) — mismo nombre repetido en Odoo, NO se cargan ──`)
  for (const a of ambiguous) console.log(`  "${a.raw}" -> ${a.hits.map(h => '#' + h.id).join(', ')}`)
}

if (notFound.length) {
  console.log(`\n── NO ENCONTRADOS EN ODOO (${notFound.length}) ──────────`)
  for (const n of notFound) console.log(`  ${n}`)
}

console.log(`\n── PUBLICADOS QUE QUEDAN FUERA DE LA MEMBRESIA (${extras.length}) ──`)
for (const e of extras) console.log(`  #${String(e.id).padEnd(5)} ${e.name}`)

console.log(`\nResumen: ${matched.length} entran · ${notFound.length} sin match · ${ambiguous.length} ambiguos · ${extras.length} publicados fuera`)

if (!APPLY) {
  console.log('\n(dry-run — nada se escribió. Correr con --apply para cargar la tabla.)')
  process.exit(0)
}

const { q, pool } = await import('./db.mjs')
await q(`
  CREATE TABLE IF NOT EXISTS public.membership_online_courses (
    odoo_channel_id INTEGER PRIMARY KEY,
    name            TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      INTEGER
  )
`)
// Reemplazo completo en una transacción: misma semántica que la pantalla de
// Configuración (la lista enviada es siempre el estado final).
await q('BEGIN')
try {
  await q('DELETE FROM public.membership_online_courses')
  for (const m of matched) {
    await q(
      'INSERT INTO public.membership_online_courses (odoo_channel_id, name) VALUES ($1, $2)',
      [m.id, m.name]
    )
  }
  await q('COMMIT')
  console.log(`\nOK: ${matched.length} cursos cargados en membership_online_courses.`)
} catch (err) {
  await q('ROLLBACK')
  console.error('\nFALLO, se hizo ROLLBACK:', err.message)
  process.exitCode = 1
}
await pool.end()
