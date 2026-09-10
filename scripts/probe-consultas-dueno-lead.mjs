// La bandeja de Comercial SIEMPRE acota por owner (views/comercial/Leads.vue ->
// buildLeadPayload: owner_user_ids = comercialOwnerIds, o sea Comercial + ADMIN
// /GERENCIA/LIDER_COMERCIAL menos FUNDACION y B2B). El cronograma no: cuenta
// todo lead de la edicion. Un lead registrado por Fundacion o B2B se ve en el
// contador y NO en la bandeja: ahi nace el descuadre de 1.
//
// Uso: node scripts/probe-consultas-dueno-lead.mjs 15510
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const ED = Number(process.argv[2] || 15510)

const backup = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env.bak-produccion')
const url = fs.readFileSync(backup, 'utf8')
  .split(/\r?\n/)
  .find(l => /^\s*DATABASE_URL\s*=/.test(l))
  .split('=').slice(1).join('=').trim()

const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10000 })
const CONSULTA = ['we_lead_status_atendido', 'we_lead_status_interesado',
  'we_lead_status_unique', 'we_lead_status_will_pay', 'we_lead_status_bought']

const { rows } = await pool.query(`
  SELECT l.user_registration_id, u.alias, r.alias AS rol, u.active AS usuario_activo,
         COUNT(*)::int AS leads
    FROM public.leads l
    JOIN public."catalog" cs ON cs.catalog_id = l.cat_status_lead
    LEFT JOIN public.users u ON u.user_id = l.user_registration_id
    LEFT JOIN public.user_roles ur ON ur.user_id = u.user_id
    LEFT JOIN public.rol r ON r.rol_id = ur.rol_id
   WHERE l.program_edition_id = $1 AND l.active = 'Y' AND cs.alias = ANY($2::text[])
   GROUP BY 1, 2, 3, 4 ORDER BY leads DESC`, [ED, CONSULTA])

console.log(`ED ${ED}: quien registro cada consulta`)
console.table(rows)

const AJENOS = ['FUNDACION', 'LIDER_FUNDACION', 'B2B', 'LIDER_B2B']
const fuera = rows.filter(r => !r.rol || AJENOS.includes(r.rol))
console.log('\n-- fuera del universo de la bandeja de Comercial --')
console.table(fuera)
console.log(`total consultas = ${rows.reduce((a, r) => a + r.leads, 0)} | invisibles en Comercial = ${fuera.reduce((a, r) => a + r.leads, 0)}`)

await pool.end()
