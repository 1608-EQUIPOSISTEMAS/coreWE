// Sondeo (solo lectura, produccion): cuantas VENTAS (universo de la columna C de
// "2. Clas. prog.") y cuantas CONSULTAS (columna H) cuelgan de una EDICION. Sin
// edicion no se puede decir si fueron de apertura o de seguimiento, que es lo que
// pide el desglose nuevo K:V.
//   cd Backend && node scripts/probe-clas-prog-cobertura-edicion.mjs
import fs from 'node:fs'
import pg from 'pg'
import { LEAD_STATUSES_CONSULTA } from '../src/modules/edition/edition.repository.js'

const MODALIDAD_ONLINE = 2623
const url = fs.readFileSync('.env.bak-produccion', 'utf8').match(/^DATABASE_URL=(.+)$/m)[1].trim()

let cliente
for (let intento = 1; intento <= 3; intento++) {
  cliente = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10000 })
  try { await cliente.connect(); break } catch (error) {
    await cliente.end().catch(() => {})
    if (intento === 3) throw new Error(`tunel SSH caido: ${error.message}`)
  }
}

const cobertura = `
  COUNT(*)::int AS total,
  COUNT(pe.edition_num_id)::int AS con_edicion,
  COUNT(*) FILTER (WHERE pe.start_date <  '2026-01-01')::int AS ed_2025,
  COUNT(*) FILTER (WHERE pe.start_date >= '2026-01-01' AND pe.start_date < '2026-09-01')::int AS ed_ene_ago,
  COUNT(*) FILTER (WHERE pe.start_date >= '2026-09-01')::int AS ed_sep_mas,
  COUNT(*) FILTER (WHERE pe.program_version_id <> pv.program_version_id)::int AS version_distinta`

const { rows: consultas } = await cliente.query(`
  SELECT ${cobertura}
    FROM public.leads l
    JOIN public."catalog" cs        ON cs.catalog_id = l.cat_status_lead
    JOIN public.program_versions pv ON pv.program_version_id = l.program_version_id
    JOIN public.programs p          ON p.program_id = pv.program_id
    LEFT JOIN public.program_editions pe ON pe.edition_num_id = l.program_edition_id
   WHERE l.active = 'Y' AND cs.alias = ANY($1::text[]) AND p.cat_model_modality <> $2
     AND l.registration_date >= '2026-01-01' AND l.registration_date < '2026-09-01'`,
[LEAD_STATUSES_CONSULTA, MODALIDAD_ONLINE])

const { rows: ventas } = await cliente.query(`
  WITH primer_pago AS (
    SELECT DISTINCT ON (pa.enrollment_id) pa.enrollment_id, pa.payment_date
      FROM public.payments pa WHERE pa.active = 'Y'
     ORDER BY pa.enrollment_id, pa.payment_date, pa.payment_id
  )
  SELECT ${cobertura}
    FROM primer_pago pp
    JOIN public.enrollments e       ON e.enrollment_id = pp.enrollment_id
    JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
    JOIN public.programs p          ON p.program_id = pv.program_id
    LEFT JOIN public.program_editions pe ON pe.edition_num_id = e.program_edition_id
   WHERE e.active = 'Y' AND p.cat_model_modality <> $1
     AND pp.payment_date >= '2026-01-01' AND pp.payment_date < '2026-09-01'`,
[MODALIDAD_ONLINE])

console.table({ consultas: consultas[0], ventas: ventas[0] })
await cliente.end()

// Consultas cuyo lead dice un programa y su edicion es de OTRO: la edicion no
// puede clasificar esa consulta (su SEGUI es de otro curso).
const reconectado = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10000 })
await reconectado.connect()
const { rows: cruces } = await reconectado.query(`
  SELECT regexp_replace(pv.abbreviation, '\s+V\d+$', '') AS lead_programa,
         regexp_replace(pve.abbreviation, '\s+V\d+$', '') AS edicion_programa,
         COUNT(*)::int AS n
    FROM public.leads l
    JOIN public."catalog" cs         ON cs.catalog_id = l.cat_status_lead
    JOIN public.program_versions pv  ON pv.program_version_id = l.program_version_id
    JOIN public.programs p           ON p.program_id = pv.program_id
    JOIN public.program_editions pe  ON pe.edition_num_id = l.program_edition_id
    JOIN public.program_versions pve ON pve.program_version_id = pe.program_version_id
   WHERE l.active = 'Y' AND cs.alias = ANY($1::text[]) AND p.cat_model_modality <> $2
     AND l.registration_date >= '2026-01-01' AND l.registration_date < '2026-09-01'
     AND regexp_replace(pv.abbreviation, '\s+V\d+$', '') <> regexp_replace(pve.abbreviation, '\s+V\d+$', '')
   GROUP BY 1, 2 ORDER BY 3 DESC`, [LEAD_STATUSES_CONSULTA, MODALIDAD_ONLINE])
console.log(`consultas con edicion de OTRO programa: ${cruces.reduce((a, r) => a + r.n, 0)}`)
console.table(cruces.slice(0, 25))
await reconectado.end()
