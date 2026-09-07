// Prueba de punta a punta del flujo nuevo: Producto cancela una edicion A5 y en
// vez de mover a los alumnos deja el destino propuesto en la bandeja de
// Reprogramaciones. Corre contra la BD LOCAL de pruebas y deshace lo que toca.
//
// Lo que se verifica: (1) nadie se movio, (2) el caso quedo 'propuesto' con
// origen 'producto' y dest_kind RP, (3) la bandeja lo muestra con el destino.
import { pool } from './db.mjs'
import { a5CancelAndHandOff } from '../src/modules/edition/edition.usecases.js'
import { reprogramacionRepository } from '../src/modules/reprogramacion/reprogramacion.repository.js'

const cx = await pool.connect()
const { rows: [db] } = await cx.query('SELECT current_database() AS db, inet_server_port() AS puerto')
if (db.db !== 'system_erp_dev') throw new Error(`Esto solo corre en pruebas, no en ${db.db}`)

// Una edicion viva (no A5) con alumnos FICO-aprobados adentro.
const { rows: [caso] } = await cx.query(`
  SELECT pe.edition_num_id, pe.specific_code, pe.cat_segment, pe.program_version_id,
         COUNT(*) AS alumnos
    FROM public.program_editions pe
    JOIN public.enrollments e ON e.program_edition_id = pe.edition_num_id AND e.active = 'Y'
    JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
                            AND cf.alias = 'we_enrollment_status_checked'
    LEFT JOIN public."catalog" cseg ON cseg.catalog_id = pe.cat_segment
   WHERE e.parent_enrollment_id IS NULL
     AND (cseg.alias IS NULL OR cseg.alias <> 'we_segment_a5')
   GROUP BY pe.edition_num_id, pe.specific_code, pe.cat_segment, pe.program_version_id
  HAVING COUNT(*) BETWEEN 1 AND 4
   ORDER BY pe.edition_num_id DESC LIMIT 1`)
if (!caso) throw new Error('No hay ninguna edicion viva con alumnos para probar')

const { rows: [destino] } = await cx.query(
  `SELECT edition_num_id FROM public.program_editions
    WHERE program_version_id = $1 AND edition_num_id <> $2 AND active = 'Y'
    ORDER BY start_date DESC LIMIT 1`, [caso.program_version_id, caso.edition_num_id])
if (!destino) throw new Error(`El programa de la edicion ${caso.edition_num_id} no tiene otra edicion`)

const { rows: pendientes } = await cx.query(
  `SELECT enrollment_id, cat_type_status, program_edition_id
     FROM public.enrollments WHERE program_edition_id = $1 AND active = 'Y'`, [caso.edition_num_id])
const antes = new Map(pendientes.map(e => [e.enrollment_id, e]))

const resp = await a5CancelAndHandOff({
  payload: {
    edition_num_id: caso.edition_num_id,
    justificacion: 'Sondeo local del hand-off a Reprogramaciones',
    migrations: [...antes.keys()].map(id => ({ enrollment_id: id, target_edition_id: destino.edition_num_id }))
  },
  user_id: 1
})

const { rows: despues } = await cx.query(
  `SELECT enrollment_id, cat_type_status, program_edition_id
     FROM public.enrollments WHERE enrollment_id = ANY($1::int[])`, [[...antes.keys()]])
const movidos = despues.filter(e => {
  const a = antes.get(e.enrollment_id)
  return a.cat_type_status !== e.cat_type_status || a.program_edition_id !== e.program_edition_id
})

const { rows: casos } = await cx.query(
  `SELECT enrollment_id, status, dest_edition_id, dest_kind, proposed_source
     FROM public.reprogram_cases WHERE enrollment_id = ANY($1::int[]) AND active = 'Y'`,
  [[...antes.keys()]])

const bandeja = (await reprogramacionRepository.listAffected())
  .filter(f => antes.has(f.enrollment_id))
  .map(f => ({ venta: f.enrollment_id, estado: f.status, destino: f.destino_codigo, origen: f.proposed_source }))

console.log({ edicion: caso.specific_code, resp })
console.log('alumnos movidos (debe ser 0):', movidos.length)
console.log('casos creados:', casos)
console.log('en la bandeja:', bandeja)

// Deshacer: la edicion vuelve a su segmento y los casos de prueba se borran.
await cx.query('UPDATE public.program_editions SET cat_segment = $2 WHERE edition_num_id = $1',
  [caso.edition_num_id, caso.cat_segment])
await cx.query('DELETE FROM public.reprogram_cases WHERE enrollment_id = ANY($1::int[])', [[...antes.keys()]])
console.log('revertido')

cx.release()
await pool.end()
