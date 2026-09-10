// Por que el contador de CONSULTAS de una edicion no cuadra con lo que espera
// negocio. Muestra el conteo crudo, el filtrado por los cinco estados de
// LEAD_STATUSES_CONSULTA, quienes quedan fuera y CUANDO se les puso ese estado
// (un lead que pasa a Cerrado hoy baja el contador sin que nadie toque codigo).
//
// Uso: node scripts/probe-consultas-edicion.mjs 15510
// Apunta a PRODUCCION leyendo .env.bak-produccion, sin tocar el .env de pruebas.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const ED = Number(process.argv[2])
if (!Number.isFinite(ED)) throw new Error('falta el edition_num_id')

const backup = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env.bak-produccion')
const url = fs.readFileSync(backup, 'utf8')
  .split(/\r?\n/)
  .find(l => /^\s*DATABASE_URL\s*=/.test(l))
  .split('=').slice(1).join('=').trim()

const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10000 })

const CONSULTA = ['we_lead_status_atendido', 'we_lead_status_interesado',
  'we_lead_status_unique', 'we_lead_status_will_pay', 'we_lead_status_bought']

const totales = await pool.query(`
  SELECT COUNT(*)::int AS crudo,
         COUNT(*) FILTER (WHERE l.active = 'Y' AND cs.alias = ANY($2::text[]))::int AS consultas
    FROM public.leads l
    LEFT JOIN public."catalog" cs ON cs.catalog_id = l.cat_status_lead
   WHERE l.program_edition_id = $1`, [ED, CONSULTA])
console.table(totales.rows)

const fuera = await pool.query(`
  SELECT l.lead_id, cs.description AS estado, l.active,
         l.registration_date::date AS creado, l.modification_date AS ultima_edicion
    FROM public.leads l
    LEFT JOIN public."catalog" cs ON cs.catalog_id = l.cat_status_lead
   WHERE l.program_edition_id = $1
     AND (l.active <> 'Y' OR cs.alias IS NULL OR NOT (cs.alias = ANY($2::text[])))
   ORDER BY l.modification_date`, [ED, CONSULTA])
console.log('\n-- leads que NO cuentan como consulta --')
console.table(fuera.rows)

const altas = await pool.query(`
  SELECT dia, nuevos, SUM(nuevos) OVER (ORDER BY dia)::int AS crudo_acumulado
    FROM (SELECT registration_date::date AS dia, COUNT(*)::int AS nuevos
            FROM public.leads WHERE program_edition_id = $1
           GROUP BY 1) t
   ORDER BY dia DESC LIMIT 10`, [ED])
console.log('\n-- altas de los ultimos dias --')
console.table(altas.rows)

await pool.end()
