// AUDITORIA: por que una ESPECIALIZACION o un DIPLOMA (un PADRE de paquete)
// aparece con alumnos en la columna SEGUI del cronograma.
//
// La duda de Planeamiento es legitima: un paquete es donde NACE la venta, sus
// modulos son los que reciben seguimiento. Que el padre tenga SEGUI suena a
// error. Este script no discute, saca nombre y apellido de cada alumno que la
// cascada de canales mete en ese balde y dice de donde vino.
//
// Solo lectura sobre produccion. Ver classroomChannelMetricsList: un padre solo
// puede sumar SEGUI por dos caminos, y el script los distingue.
import fs from 'node:fs'
import pg from 'pg'
import { EditionRepository } from '../src/modules/edition/edition.repository.js'

const ANIO = Number(process.argv[2] ?? 2026)
const MES_FINAL = Number(process.argv[3] ?? 8)
const INTENTOS = 3

const esPaquete = abreviatura => /^(ESP|ESPEC|DIP)\b|^ESPEC\./i.test(abreviatura.trim())

const urlDeProduccion = () =>
  fs.readFileSync('.env.bak-produccion', 'utf8').match(/^DATABASE_URL=(.+)$/m)[1].trim()

async function conectarConReintento () {
  for (let intento = 1; intento <= INTENTOS; intento++) {
    const cliente = new pg.Client({ connectionString: urlDeProduccion(), connectionTimeoutMillis: 10000 })
    try { await cliente.connect(); return cliente } catch (error) {
      await cliente.end().catch(() => {})
      if (intento === INTENTOS) throw new Error(`tunel SSH caido tras ${INTENTOS} intentos: ${error.message}`)
    }
  }
}

const cliente = await conectarConReintento()

const { rows: ediciones } = await cliente.query(`
  SELECT pe.edition_num_id, pe.specific_code, pe.start_date, pv.abbreviation AS curso
    FROM public.program_editions pe
    JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
   WHERE pe.active = 'Y'
     AND pe.start_date >= make_date($1, 1, 1)
     AND pe.start_date <  make_date($1, $2, 1) + INTERVAL '1 month'`, [ANIO, MES_FINAL])

const paquetes = ediciones.filter(e => esPaquete(e.curso))
const repo = new EditionRepository(cliente)
const metricas = await repo.classroomChannelMetricsList(paquetes.map(e => e.edition_num_id))
const conSeguimiento = new Map(metricas.filter(m => m.cnt_segui > 0).map(m => [m.edition_num_id, m]))

const sospechosas = paquetes.filter(e => conSeguimiento.has(e.edition_num_id))

// De cada inscrito elegible de esas ediciones sacamos los DOS unicos origenes
// posibles de un SEGUI en un padre, para poder senalar cual fue.
const { rows: alumnos } = await cliente.query(`
  SELECT e.program_edition_id AS edition_num_id,
         e.enrollment_id,
         TRIM(concat_ws(' ', per.first_name, per.last_name)) AS alumno,
         e.total_amount,
         e.parent_enrollment_id,
         pvpar.abbreviation  AS programa_del_padre,
         pepar.specific_code AS edicion_del_padre,
         EXISTS (SELECT 1 FROM public.course_changes cc
                  WHERE cc.enrollment_destination_id = e.enrollment_id) AS es_destino_cc,
         (e.notes ILIKE '%Reprogramacion desde inscripcion #%')         AS es_destino_rp
    FROM public.enrollments e
    JOIN public."catalog" cf       ON cf.catalog_id = e.cat_fico_status
    JOIN public.customers cust     ON cust.customer_id = e.customer_id
    JOIN public.persons per        ON per.person_id = cust.person_id
    LEFT JOIN public."catalog" cts ON cts.catalog_id = e.cat_type_status
    LEFT JOIN public.enrollments par        ON par.enrollment_id = e.parent_enrollment_id
    LEFT JOIN public.program_versions pvpar ON pvpar.program_version_id = par.program_version_id
    LEFT JOIN public.program_editions pepar ON pepar.edition_num_id = par.program_edition_id
   WHERE e.program_edition_id = ANY($1::int[])
     AND e.active = 'Y'
     AND cf.alias = 'we_enrollment_status_checked'
     AND (cts.alias IS NULL OR cts.alias NOT IN (
            'we_enrollment_status_retired',
            'we_enrollment_status_course_changed',
            'we_enrollment_status_reprogrammed'))
     AND (e.parent_enrollment_id IS NOT NULL
          OR EXISTS (SELECT 1 FROM public.course_changes cc
                      WHERE cc.enrollment_destination_id = e.enrollment_id)
          OR e.notes ILIKE '%Reprogramacion desde inscripcion #%')`,
  [sospechosas.map(e => e.edition_num_id)])

const porEdicion = new Map()
for (const a of alumnos) {
  if (!porEdicion.has(a.edition_num_id)) porEdicion.set(a.edition_num_id, [])
  porEdicion.get(a.edition_num_id).push(a)
}

const motivo = a =>
  a.es_destino_cc ? 'CAMBIO DE CURSO (llego de otro programa)'
    : a.es_destino_rp ? 'REPROGRAMACION (cambio de fecha)'
      : `MODULO DE ${a.programa_del_padre} ${a.edicion_del_padre ?? 'E0'} (el paquete se vendio dentro de otro)`

for (const e of sospechosas.sort((a, b) => a.curso.localeCompare(b.curso, 'es'))) {
  const m = conSeguimiento.get(e.edition_num_id)
  console.log(`\n${e.curso} ${e.specific_code} (inicio ${e.start_date.toISOString().slice(0, 10)}) -> VENTAS ${m.cnt_ventas} | SEGUI ${m.cnt_segui}`)
  for (const a of porEdicion.get(e.edition_num_id) ?? []) {
    console.log(`   #${a.enrollment_id} ${a.alumno} | S/${a.total_amount} | ${motivo(a)}`)
  }
}

console.error(`\n-- ${paquetes.length} ediciones de paquete en ${ANIO} hasta el mes ${MES_FINAL}`)
console.error(`-- ${sospechosas.length} con SEGUI > 0, ${alumnos.length} alumnos con origen rastreable`)
await cliente.end()
