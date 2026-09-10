// CONSULTAS por programa y CONVERSION contra las ventas, para la hoja
// "2. Clas. prog." del libro de Planeamiento.
//
// Consulta = lead en uno de los CINCO estados que Planeamiento cuenta como tal:
// Atendido, Interesado, Unico contacto, Pagara y Pago. Los demas (Cerrado,
// Eliminado, Desestimado, Indiferente, Prox. Inicio) NO son consulta. Es la
// misma lista blanca que usa el cronograma (LEAD_STATUSES_CONSULTA); a
// proposito no es una lista negra: un estado nuevo del catalogo no debe empezar
// a contar solo por existir.
//
// TODO el ano sale del ERP, enero incluido. La duda era legitima —con las
// VENTAS el ERP si tiene un hueco grande en enero— pero con las consultas no
// aplica: la tabla leads arranca el 04/12/2025, antes de que empezara el ano, y
// enero tiene cobertura diaria continua (51 a 240 consultas por dia, sin un
// solo dia vacio). El modulo comercial entro en produccion antes que FICO.
//
// El programa se toma de leads.program_version_id, NO de la edicion: 30.121 de
// las 31.180 consultas lo tienen (96,6%), mientras que 20 de las 67 ediciones
// de enero no tienen ni una consulta colgada. Eso ultimo no es un hueco de
// datos, es que una edicion que arranca la primera semana de enero se vendio en
// noviembre y diciembre: sus consultas son de 2025.
//
// Se excluye la modalidad Online por el mismo motivo que en las ventas: el
// mismo curso existe duplicado en vivo y online, y la hoja solo lista los en
// vivo (ver ventas-e-ingreso-inicial-por-programa.mjs).
import fs from 'node:fs'
import pg from 'pg'
import { LEAD_STATUSES_CONSULTA } from '../src/modules/edition/edition.repository.js'

const ANIO = Number(process.argv[2] ?? 2026)
const MES_FINAL = Number(process.argv[3] ?? 8)
const MODALIDAD_ONLINE = 2623
const INTENTOS = 3

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

const { rows } = await cliente.query(`
  SELECT pv.abbreviation AS programa, COUNT(*)::int AS consultas
    FROM public.leads l
    JOIN public."catalog" cs        ON cs.catalog_id = l.cat_status_lead
    JOIN public.program_versions pv ON pv.program_version_id = l.program_version_id
    JOIN public.programs p          ON p.program_id = pv.program_id
   WHERE l.active = 'Y'
     AND cs.alias = ANY($3::text[])
     AND p.cat_model_modality <> $4
     AND l.registration_date >= make_date($1, 1, 1)
     AND l.registration_date <  make_date($1, $2, 1) + INTERVAL '1 month'
   GROUP BY 1
   ORDER BY 1`, [ANIO, MES_FINAL, LEAD_STATUSES_CONSULTA, MODALIDAD_ONLINE])

const csv = ['PROGRAMA;CONSULTAS']
for (const f of rows) csv.push(`${f.programa};${f.consultas}`)
console.log(csv.join('\n'))

const total = rows.reduce((a, f) => a + f.consultas, 0)
console.error(`\n-- ${rows.length} programas | ${total.toLocaleString('es-PE')} consultas de enero al mes ${MES_FINAL} de ${ANIO}`)
await cliente.end()
