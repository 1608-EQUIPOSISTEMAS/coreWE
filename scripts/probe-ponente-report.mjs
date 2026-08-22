// Comprueba la fila 1.8 Ponentes del cuadro de Fundacion > Objetivos:
// un ponente NO cuenta como venta de ningun area y suma en la columna VIP.
//
// Marca un enrollment de evento como PONENTE dentro de una transaccion, corre
// la misma query del reporte y hace ROLLBACK: no deja rastro en la BD.
//
//   node scripts/probe-ponente-report.mjs            (BD del .env = pruebas)
//   node scripts/probe-ponente-report.mjs 123        (una edicion en concreto)
import { pool } from './db.mjs'
import { EditionRepository } from '../src/modules/edition/edition.repository.js'

const editionArg = Number(process.argv[2]) || null

const resumen = (filas) => filas
  .map(r => `  ${r.area_code}  avance=${r.avance}  vip=${r.vip}  general=${r.general}`)
  .join('\n') || '  (sin filas)'

const client = await pool.connect()
try {
  await client.query('BEGIN')

  const { rows: [caso] } = await client.query(`
    SELECT e.enrollment_id, e.program_edition_id AS edition_num_id
      FROM public.enrollments e
     WHERE e.active = 'Y'
       AND e.cat_event_category IS NOT NULL
       AND ($1::int IS NULL OR e.program_edition_id = $1)
     ORDER BY e.enrollment_id DESC
     LIMIT 1
  `, [editionArg])

  if (!caso) {
    console.log('No hay inscripciones de evento en esta BD: nada que comprobar.')
    process.exit(0)
  }

  const repo = new EditionRepository(client)

  const antes = await repo.eventReportAreas(caso.edition_num_id)
  console.log(`Edicion ${caso.edition_num_id} — antes:\n${resumen(antes)}`)

  await client.query(`
    UPDATE public.enrollments
       SET cat_event_category = (SELECT catalog_id FROM public.catalog
                                  WHERE alias = 'we_event_category_ponente')
     WHERE enrollment_id = $1
  `, [caso.enrollment_id])

  const despues = await repo.eventReportAreas(caso.edition_num_id)
  console.log(`Con el enrollment ${caso.enrollment_id} como PONENTE:\n${resumen(despues)}`)

  const fila = despues.find(r => r.area_code === '1.8')
  const totalAvance = (filas) => filas.reduce((acc, r) => acc + Number(r.avance), 0)
  const okFila = Number(fila?.avance) > 0 && Number(fila.vip) === Number(fila.avance)
  const okTotal = totalAvance(despues) === totalAvance(antes)

  console.log(okFila && okTotal
    ? 'OK: el ponente quedo en la fila 1.8 y suma en la columna VIP, sin alterar el total.'
    : `FALLA: fila 1.8 = ${JSON.stringify(fila)} | total antes/despues = ${totalAvance(antes)}/${totalAvance(despues)}`)
} finally {
  await client.query('ROLLBACK')
  client.release()
  await pool.end()
}
