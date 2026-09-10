// Que PROGRAMAS se venden como PAQUETE (diplomas, especializaciones, PEE): la
// inscripcion es un padre y los modulos cuelgan de el como hijos.
//
// Se le pregunta a la BD en vez de mirar el prefijo del nombre. El prefijo
// miente en los dos sentidos: deja fuera a los PEE (PEE ANALIST DATOS es un
// paquete en 151 de sus 152 ventas) y, si alguien bautiza "ESP. X" a un curso
// suelto, lo mete de contrabando.
//
// El corte es nitido y por eso el umbral no es delicado: los paquetes reales
// van de 6/6 a 351/357 (>=94%), y los cursos sueltos con UNA venta rara que
// arrastro modulos van de 1/550 a 2/55 (<=4%). No hay nada en medio.
//
// Solo lectura sobre produccion, via DATABASE_URL (nunca PGPASSWORD).
import fs from 'node:fs'
import pg from 'pg'

const ANIO = Number(process.argv[2] ?? 2026)
const MES_FINAL = Number(process.argv[3] ?? 8)
const RUTA_SALIDA = process.argv[4] ?? 'programas-paquete.json'
const PROPORCION_MINIMA = 0.5

const cliente = new pg.Client({
  connectionString: fs.readFileSync('.env.bak-produccion', 'utf8').match(/^DATABASE_URL=(.+)$/m)[1].trim()
})
await cliente.connect()

const { rows } = await cliente.query(`
  SELECT pv.abbreviation AS curso,
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM public.enrollments ch WHERE ch.parent_enrollment_id = e.enrollment_id
         ))::int AS con_modulos,
         COUNT(*)::int AS inscripciones
    FROM public.enrollments e
    JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
    JOIN public.program_editions pe ON pe.edition_num_id = e.program_edition_id
   WHERE e.active = 'Y'
     AND pe.start_date >= make_date($1, 1, 1)
     AND pe.start_date <  make_date($1, $2, 1) + INTERVAL '1 month'
   GROUP BY 1
   ORDER BY 1`, [ANIO, MES_FINAL])

const paquetes = rows.filter(r => r.con_modulos / r.inscripciones >= PROPORCION_MINIMA)
fs.writeFileSync(RUTA_SALIDA, JSON.stringify(paquetes.map(r => r.curso), null, 2))

for (const r of paquetes) console.error(`-- ${r.curso}: ${r.con_modulos}/${r.inscripciones}`)
console.error(`\n${paquetes.length} programas de paquete -> ${RUTA_SALIDA}`)
await cliente.end()
