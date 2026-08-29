// Por que el contador de CONSULTAS del cronograma no cuadra con el del modulo.
//
// El cronograma (edition.repository.js -> classroomLeadsCountList) cuenta por
// LISTA NEGRA: todo lead activo de la edicion menos Desestimado, Cerrado e
// Indiferente. Este script muestra el desglose por estado para ver que se cuela
// frente a la lista blanca de negocio (Atendido, Interesado, Unico contacto,
// Pagara, Pago).
//
// Uso:  node scripts/probe-consultas-cronograma.mjs [texto del programa]
//       node scripts/probe-consultas-cronograma.mjs python
import { q, pool } from './db.mjs'

const BUSCA = process.argv[2] || 'python'

// Los cinco estados que negocio quiere contar como consulta.
const LISTA_BLANCA = [
  'we_lead_status_atendido',
  'we_lead_status_interesado',
  'we_lead_status_unique',
  'we_lead_status_will_pay',
  'we_lead_status_bought'
]

// Los tres que el cronograma excluye hoy.
const LISTA_NEGRA = [
  'we_lead_status_desestimado',
  'we_lead_status_closed',
  'we_lead_status_indiferente'
]

const { rows: ediciones } = await q(`
  SELECT pe.edition_num_id, pe.specific_code, pr.program_name, pe.start_date,
         COUNT(l.lead_id)::int AS leads_activos
    FROM public.program_editions pe
    JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
    JOIN public.programs pr         ON pr.program_id = pv.program_id
    LEFT JOIN public.leads l ON l.program_edition_id = pe.edition_num_id AND l.active = 'Y'
   WHERE pr.program_name ILIKE '%' || $1 || '%'
   GROUP BY pe.edition_num_id, pe.specific_code, pr.program_name, pe.start_date
  HAVING COUNT(l.lead_id) > 0
   ORDER BY COUNT(l.lead_id) DESC
   LIMIT 10
`, [BUSCA])

console.log(`\nEdiciones que matchean "${BUSCA}" con leads activos:`)
console.table(ediciones)

for (const ed of ediciones.slice(0, 3)) {
  const { rows: desglose } = await q(`
    SELECT COALESCE(cs.description, '(sin estado)') AS estado,
           COALESCE(cs.alias, '(null)')             AS alias,
           COUNT(*)::int                            AS leads
      FROM public.leads l
      LEFT JOIN public."catalog" cs ON cs.catalog_id = l.cat_status_lead
     WHERE l.program_edition_id = $1
       AND l.active = 'Y'
     GROUP BY cs.description, cs.alias
     ORDER BY COUNT(*) DESC
  `, [ed.edition_num_id])

  const suma = (fn) => desglose.filter(fn).reduce((t, r) => t + r.leads, 0)
  const cronograma = suma(r => !LISTA_NEGRA.includes(r.alias))
  const negocio = suma(r => LISTA_BLANCA.includes(r.alias))

  console.log(`\n== ${ed.program_name} / ${ed.specific_code} (edicion ${ed.edition_num_id})`)
  console.table(desglose.map(r => ({
    ...r,
    cuenta_cronograma: LISTA_NEGRA.includes(r.alias) ? '' : 'SI',
    cuenta_negocio: LISTA_BLANCA.includes(r.alias) ? 'SI' : ''
  })))
  console.log(`   cronograma (hoy, lista negra): ${cronograma}`)
  console.log(`   negocio (lista blanca de 5):   ${negocio}`)
  console.log(`   diferencia:                    ${cronograma - negocio}`)
}

// Que estados deja pasar el listado de Comercial (sp_comercial_lead_list), que
// es contra lo que el usuario compara el numero del cronograma.
const { rows: [sp] } = await q(`
  SELECT pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'sp_comercial_lead_list'
`)
const lineas = (sp?.def || '').split(/\r?\n/).filter(l => /status|estado/i.test(l))
console.log('\n== Filtro de estado en sp_comercial_lead_list:')
console.log(lineas.join('\n') || '   (no filtra por estado)')

// Impacto global de pasar de lista negra a lista blanca: que estados dejarian
// de contar y cuantos leads son. Los que hoy se cuelan son el "de mas".
const { rows: global } = await q(`
  SELECT COALESCE(cs.description, '(sin estado)') AS estado,
         COALESCE(cs.alias, '(null)')             AS alias,
         COUNT(*)::int                            AS leads,
         COUNT(DISTINCT l.program_edition_id)::int AS ediciones
    FROM public.leads l
    LEFT JOIN public."catalog" cs ON cs.catalog_id = l.cat_status_lead
   WHERE l.active = 'Y'
     AND l.program_edition_id IS NOT NULL
   GROUP BY cs.description, cs.alias
   ORDER BY COUNT(*) DESC
`)

console.log('\n== Todos los leads activos con edicion, por estado:')
console.table(global.map(r => ({
  ...r,
  cuenta_hoy: LISTA_NEGRA.includes(r.alias) ? '' : 'SI',
  con_lista_blanca: LISTA_BLANCA.includes(r.alias) ? 'SI' : ''
})))

const sobran = global.filter(r => !LISTA_NEGRA.includes(r.alias) && !LISTA_BLANCA.includes(r.alias))
console.log(`\n   Leads que hoy se cuelan y saldrian con la lista blanca: ${sobran.reduce((t, r) => t + r.leads, 0)}`)
console.table(sobran)

await pool.end()
