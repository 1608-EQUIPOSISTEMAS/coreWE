// Sondeo: por que la categoria PONENTE no aparece en /fico/inscripciones/new.
//
// Son tres capas y las tres tienen que estar: la fila del catalogo, la fila
// encendida en event_category_prices para ESA version del programa (sin ella
// program.repository.eventCategoryList la filtra) y las inscripciones que ya
// la usan. Solo lee.
//   node scripts/probe-ponente-encendido.mjs                 (BD del .env)
//   PROD_URL=postgresql://... node scripts/probe-ponente-encendido.mjs
import pg from 'pg'

const cliente = new pg.Client({
  connectionString: process.env.PROD_URL || 'postgresql://postgres:postgres@127.0.0.1:5433/system_erp_dev',
  ssl: false
})
await cliente.connect()

const { rows: catalogo } = await cliente.query(`
  SELECT c.catalog_id, c.alias, c.description, c.active
    FROM catalog c JOIN catalog p ON p.catalog_id = c.catalog_parent_id
   WHERE p.alias = 'we_event_category' ORDER BY c.description`)
console.log('\n── Catalogo de categorias de entrada ──'); console.table(catalogo)

const { rows: eventos } = await cliente.query(`
  SELECT pe.edition_num_id, pv.program_version_id, pv.description AS programa,
         string_agg(c.description || '=' || ecp.active, ', ' ORDER BY c.description) AS categorias
    FROM event_category_prices ecp
    JOIN catalog c ON c.catalog_id = ecp.cat_event_category
    JOIN program_versions pv ON pv.program_version_id = ecp.program_version_id
    LEFT JOIN program_editions pe ON pe.program_version_id = pv.program_version_id
   GROUP BY pe.edition_num_id, pv.program_version_id, pv.description
   ORDER BY pv.program_version_id DESC`)
console.log('\n── Categorias encendidas por evento ──'); console.table(eventos)

const { rows: ponentes } = await cliente.query(`
  SELECT enrollment_id, program_edition_id, event_seat
    FROM enrollments
   WHERE cat_event_category = (SELECT catalog_id FROM catalog
                                WHERE alias = 'we_event_category_ponente')`)
console.log(`\n── Inscripciones PONENTE: ${ponentes.length} ──`); console.table(ponentes)

await cliente.end()
