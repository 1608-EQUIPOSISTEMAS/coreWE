// Promedio de VENTAS por edicion, partido en apertura vs seguimiento y en
// temporalidad alta vs normal. Alimenta el bloque "2026 (Ventas)" de la hoja
// "Planificacion Programacion - Consultas - Ventas" (Planeamiento).
//
// Reglas de negocio (Planeamiento, 08/09/2026):
//  - La edicion es SEGUIMIENTO si su columna SEGUI llega a SEGUIMIENTO_MINIMO;
//    si no, es APERTURA. Clasifica la FILA del cronograma, no al alumno.
//  - Lo que promedia es siempre VENTAS, tambien en las filas de seguimiento:
//    KPIS Y OKRS con VENTAS 14 / SEGUI 6 aporta 14 al promedio de seguimiento.
//  - Mes alto = enero, febrero, marzo y julio; normal = abril a agosto restante.
//  - Solo entran ENERO A AGOSTO: de septiembre en adelante las ediciones aun
//    estan vendiendo y su promedio no significa nada.
//
// NINGUNA de las dos fuentes esta completa sola, por eso se combinan:
//  - Cronograma (ene-may): en el ERP, el 20% de las ediciones de enero y
//    febrero estan vacias porque el sistema arranco despues. En mayo las dos
//    fuentes dan el mismo numero en 37 de 60 ediciones y el resto difiere en
//    +-1: mismo criterio de VENTAS, distinta completitud.
//  - ERP (jun-ago): la columna VENTAS del cronograma esta caida desde JUNIO.
//    En junio solo 2 de 47 ediciones coinciden y 13 marcan cero teniendo hasta
//    25 ventas reales (SAP HANA MM E10-26); julio marca 52 ventas y agosto 0,
//    con aulas de 45 alumnos, y OB.V sale #REF! en toda la pestana de julio.
// Si Planeamiento arregla esa columna, MESES_DEL_ERP vuelve a quedar vacio.
import fs from 'node:fs'
import { leerCronograma } from './lib/cronograma-vacantes.mjs'
import {
  MES_FINAL, MESES_ALTOS, MESES_DEL_ERP, crearClasificador, mesDe, temporalidad
} from './lib/clasificacion-ediciones.mjs'

const [RUTA_CRONOGRAMA, RUTA_ERP, RUTA_PAQUETES] = process.argv.slice(2)

const clasificar = crearClasificador(JSON.parse(fs.readFileSync(RUTA_PAQUETES, 'utf8')))
const esSeguimiento = fila => clasificar(fila) === 'SEGUIMIENTO'

const promedio = valores =>
  valores.length ? Number((valores.reduce((a, b) => a + b, 0) / valores.length).toFixed(1)) : null

// Una fila sin VENTAS o sin SEGUI es una programacion todavia sin llenar: no
// promedia, ni siquiera como cero.
const estaLlena = fila => fila.ventas !== null && fila.segui !== null

function filasDelPeriodo (cronograma, erp) {
  const delCronograma = cronograma.filter(f =>
    estaLlena(f) && mesDe(f) <= MES_FINAL && !MESES_DEL_ERP.has(mesDe(f)))
  const delErp = erp.filter(f => MESES_DEL_ERP.has(mesDe(f)))
  return [...delCronograma, ...delErp]
}

function agruparPorCurso (filas) {
  const grupos = new Map()
  for (const fila of filas) {
    const celda = `${esSeguimiento(fila) ? 'SEG' : 'APE'}_${temporalidad(fila)}`
    if (!grupos.has(fila.curso)) {
      grupos.set(fila.curso, { APE_ALTA: [], APE_NORMAL: [], SEG_ALTA: [], SEG_NORMAL: [] })
    }
    grupos.get(fila.curso)[celda].push(fila.ventas)
  }
  return grupos
}

const cronograma = leerCronograma(RUTA_CRONOGRAMA)
const erp = JSON.parse(fs.readFileSync(RUTA_ERP, 'utf8'))
const filas = filasDelPeriodo(cronograma, erp)
const grupos = agruparPorCurso(filas)

// --detalle vuelca la edicion por edicion que sostiene cada promedio: es lo que
// permite revisar a mano un numero que sorprende.
if (process.argv.includes('--detalle')) {
  const detalle = ['CURSO;EDICION;INICIO;MES;FUENTE;VENTAS;SEGUI;CLASIFICACION']
  for (const f of filas.sort((a, b) => a.curso.localeCompare(b.curso, 'es') || a.inicio.localeCompare(b.inicio))) {
    detalle.push([f.curso, f.edicion ?? '', f.inicio, mesDe(f),
      MESES_DEL_ERP.has(mesDe(f)) ? 'ERP' : 'CRONOGRAMA', f.ventas, f.segui,
      `${esSeguimiento(f) ? 'SEGUIMIENTO' : 'APERTURA'} ${temporalidad(f)}`].join(';'))
  }
  console.log(detalle.join('\n'))
  process.exit(0)
}

const csv = ['CURSO;APERTURA ALTA;n;APERTURA NORMAL;n;SEGUIMIENTO ALTA;n;SEGUIMIENTO NORMAL;n']
for (const [curso, v] of [...grupos].sort((a, b) => a[0].localeCompare(b[0], 'es'))) {
  csv.push([curso,
    promedio(v.APE_ALTA), v.APE_ALTA.length,
    promedio(v.APE_NORMAL), v.APE_NORMAL.length,
    promedio(v.SEG_ALTA), v.SEG_ALTA.length,
    promedio(v.SEG_NORMAL), v.SEG_NORMAL.length].map(x => x ?? '').join(';'))
}
console.log(csv.join('\n'))

const porMes = new Map()
for (const fila of filas) {
  const mes = mesDe(fila)
  const m = porMes.get(mes) ?? { aperturas: 0, seguimientos: 0, ventas: 0 }
  m[esSeguimiento(fila) ? 'seguimientos' : 'aperturas']++
  m.ventas += fila.ventas
  porMes.set(mes, m)
}
console.error(`\n-- ${filas.length} ediciones, ${grupos.size} cursos`)
console.error('-- mes fuente aperturas/seguimientos ventas')
for (const mes of [...porMes.keys()].sort((a, b) => a - b)) {
  const m = porMes.get(mes)
  const fuente = MESES_DEL_ERP.has(mes) ? 'ERP ' : 'CRON'
  const alto = MESES_ALTOS.has(mes) ? 'ALTO' : '    '
  console.error(`--  ${String(mes).padStart(2)} ${fuente} ${alto}  ${String(m.aperturas).padStart(3)}/${String(m.seguimientos).padStart(3)}  ${m.ventas}`)
}
