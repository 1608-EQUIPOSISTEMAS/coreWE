// Anuncios de Producto (Salvador Chirinos, 17/08): cambios de fecha de las ESP
// EXCEL y eliminacion de DIP/ESP FINANZAS con sus seguimientos.
//
// Lo que importa acá: las eliminaciones son cancelaciones A5, y el arreglo del
// flujo A5 todavia NO esta desplegado. Antes de que las ejecuten hay que saber
// cuantos alumnos vivos hay adentro de cada una.
import { q, pool } from './db.mjs'

const VIVO = `e.active = 'Y'
  AND cf.alias = 'we_enrollment_status_checked'
  AND (cts.alias IS NULL OR cts.alias NOT IN (
         'we_enrollment_status_retired',
         'we_enrollment_status_course_changed',
         'we_enrollment_status_reprogrammed'))`

const buscar = async (patron, desde, hasta) => {
  const { rows } = await q(`
    SELECT pe.edition_num_id, pe.global_code, p.program_name,
           pe.start_date::date AS inicio, pe.active,
           COALESCE(cseg.description, '—') AS segmento,
           dc.description AS dias, hc.description AS horario,
           (SELECT COUNT(*)::int FROM public.enrollments e
              JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
              LEFT JOIN public."catalog" cts ON cts.catalog_id = e.cat_type_status
             WHERE e.program_edition_id = pe.edition_num_id AND ${VIVO}) AS vivos,
           (SELECT COUNT(*)::int FROM public.enrollments e
              JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
              LEFT JOIN public."catalog" cts ON cts.catalog_id = e.cat_type_status
             WHERE e.program_edition_id = pe.edition_num_id
               AND e.parent_enrollment_id IS NULL AND ${VIVO}) AS ventas
      FROM public.program_editions pe
      JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
      JOIN public.programs p ON p.program_id = pv.program_id
      LEFT JOIN public."catalog" cseg ON cseg.catalog_id = pe.cat_segment
      LEFT JOIN public."catalog" dc ON dc.catalog_id = pe.cat_day_combination_id
      LEFT JOIN public."catalog" hc ON hc.catalog_id = pe.cat_hour_combination_id
     WHERE p.program_name ILIKE $1
       AND pe.start_date BETWEEN $2 AND $3
     ORDER BY pe.start_date`, [patron, desde, hasta])
  return rows
}

const bloque = async (titulo, patron, desde, hasta) => {
  const rows = await buscar(patron, desde, hasta)
  console.log(`\n===== ${titulo} =====`)
  if (rows.length === 0) return console.log('  (sin coincidencias)')
  rows.forEach(r => console.log(
    `  #${r.edition_num_id} ${String(r.global_code).padEnd(6)} ${r.inicio.toISOString().slice(0, 10)} ` +
    `[${r.segmento}] act=${r.active} ${String(r.dias || '').padEnd(10)} ${String(r.horario || '').padEnd(14)} ` +
    `vivos=${String(r.vivos).padStart(3)} (ventas ${r.ventas}) — ${r.program_name}`))
}

// --- Anuncio 1: cambios de fecha 16/08 -> 23/08 (actualizacion interna) ---
await bloque('ESP EXCEL / EXCEL EXPERT (16/08)', '%EXCEL%', '2026-08-10', '2026-08-31')

// --- Anuncio 2: eliminaciones (= cancelacion A5) ---
await bloque('DIP FINANZAS (23/08)', '%GESTIÓN FINANCIERA%', '2026-08-01', '2026-09-15')
await bloque('ESP FINANZAS (11/10)', '%FINANZAS APLICADAS%', '2026-09-15', '2026-11-15')
await bloque('Seguimientos: PLANEAMIENTO FINANCIERO', '%PLANEAMIENTO FINANCIERO%', '2026-08-01', '2026-09-15')
await bloque('Seguimientos: CONTABILIDAD FINANCIERA CON ERP', '%CONTABILIDAD FINANCIERA CON ERP%', '2026-09-15', '2026-11-15')
await bloque('Seguimientos: COSTOS Y PRESUPUESTOS', '%COSTOS Y PRESUPUESTOS%', '2026-11-01', '2026-12-31')
await bloque('Seguimientos: SAP HANA FI', '%SAP S/4 HANA FI%', '2027-01-01', '2027-02-01')
await bloque('Seguimientos: GESTIÓN FINANCIERA DE PROYECTOS', '%GESTIÓN FINANCIERA DE PROYECTOS%', '2027-02-01', '2027-03-15')

await pool.end()
