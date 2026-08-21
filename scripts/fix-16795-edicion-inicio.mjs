// One-off: el enrollment 16795 (RONALDO JACINTO PEÑA, DIP INTELIG. Y ANALIST.
// DATOS V2) quedo enganchado a la edicion E37 que inicia el 05/09 cuando el
// alumno va en la E38 que inicia el 08/10: el cliente cambio de fecha a ultima
// hora y el asesor lo pidio despues del registro.
//
// El "inicio" de una inscripcion NO es una columna de enrollments: sale de
// program_editions.start_date, asi que corregirlo = mover program_edition_id.
//
// Las fechas se piden con to_char y no como Date: el driver pg las convierte a
// la zona del proceso (-05) y comparar el Date crudo corre el dia.
//
//   node scripts/fix-16795-edicion-inicio.mjs            -> solo muestra
//   node scripts/fix-16795-edicion-inicio.mjs --aplicar  -> escribe
import { q, pool } from './db.mjs'

const ENROLLMENT_ID = 16795
const INICIO_DESTINO = '2026-10-08'
const JUSTIFICACION = 'Se cambio a solicitud del asesor: el cliente hizo el cambio de fecha de inicio a ultima hora.'
const aplicar = process.argv.includes('--aplicar')

const { rows: [actual] } = await q(
  `SELECT e.enrollment_id, e.program_version_id, e.program_edition_id, e.parent_enrollment_id,
          pv.abbreviation AS programa,
          pe.global_code,
          to_char(pe.start_date, 'YYYY-MM-DD') AS inicio,
          per.first_name || ' ' || per.last_name AS alumno
     FROM public.enrollments e
     LEFT JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
     LEFT JOIN public.program_editions pe ON pe.edition_num_id     = e.program_edition_id
     LEFT JOIN public.customers c         ON c.customer_id         = e.customer_id
     LEFT JOIN public.persons  per        ON per.person_id         = c.person_id
    WHERE e.enrollment_id = $1`, [ENROLLMENT_ID])

if (!actual) throw new Error(`No existe el enrollment ${ENROLLMENT_ID}`)
console.log('ACTUAL:', actual)

// Un padre de paquete arrastra hijos con edicion propia: si los hay, se decide
// aparte, este script no los toca.
const { rows: hijos } = await q(
  `SELECT e.enrollment_id, pv.abbreviation AS programa, pe.global_code,
          to_char(pe.start_date, 'YYYY-MM-DD') AS inicio
     FROM public.enrollments e
     LEFT JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
     LEFT JOIN public.program_editions pe ON pe.edition_num_id     = e.program_edition_id
    WHERE e.parent_enrollment_id = $1`, [ENROLLMENT_ID])
console.log(`HIJOS: ${hijos.length}`); if (hijos.length) console.table(hijos)

const { rows: [destino] } = await q(
  `SELECT edition_num_id, global_code, to_char(start_date, 'YYYY-MM-DD') AS inicio
     FROM public.program_editions
    WHERE program_version_id = $1 AND start_date::date = $2::date`,
  [actual.program_version_id, INICIO_DESTINO])
if (!destino) throw new Error(`Ninguna edicion del programa inicia el ${INICIO_DESTINO}`)
console.log('DESTINO:', destino)

if (!aplicar) { console.log('\n(dry-run: nada escrito. Correr con --aplicar)'); await pool.end(); process.exit(0) }

const cliente = await pool.connect()
try {
  await cliente.query('BEGIN')
  await cliente.query(
    `UPDATE public.enrollments
        SET program_edition_id = $1, modification_date = NOW()
      WHERE enrollment_id = $2`, [destino.edition_num_id, ENROLLMENT_ID])
  await cliente.query(
    `INSERT INTO public.enrollment_audit_log (enrollment_id, action, performed_by, details, justificacion, changes)
     VALUES ($1, 'edition_reprogrammed', NULL, $2, $3, $4::jsonb)`,
    [ENROLLMENT_ID,
     `Correccion de la fecha de inicio: ${actual.global_code} (${actual.inicio}) -> ${destino.global_code} (${destino.inicio}).`,
     JUSTIFICACION,
     JSON.stringify({
       Edicion: { old: actual.global_code, new: destino.global_code },
       Inicio:  { old: actual.inicio, new: destino.inicio }
     })])
  await cliente.query('COMMIT')
} catch (err) { await cliente.query('ROLLBACK'); throw err } finally { cliente.release() }

// El panel FICO lee la cabecera de la matview, no de enrollments.
await q('REFRESH MATERIALIZED VIEW public.mv_enrollment_report_system')

const { rows: [verif] } = await q(
  `SELECT e.enrollment_id, pe.global_code, to_char(pe.start_date, 'YYYY-MM-DD') AS inicio
     FROM public.enrollments e
     JOIN public.program_editions pe ON pe.edition_num_id = e.program_edition_id
    WHERE e.enrollment_id = $1`, [ENROLLMENT_ID])
console.log('VERIFICADO:', verif)
const { rows: log } = await q(
  `SELECT audit_id, action, details, justificacion, changes
     FROM public.enrollment_audit_log WHERE enrollment_id = $1 ORDER BY performed_at`, [ENROLLMENT_ID])
console.log('HISTORIAL:', log)
await pool.end()
