// Base del "Objetivo de ventas por edicion" de la hoja "1. Plan 2027": las cuatro
// columnas AL:AO (Apertura Alta/Normal, Seguimiento Alta/Normal) de las que
// cuelgan las 16 columnas de ventas y las 12 de consultas.
//
// Reglas de negocio (Planeamiento, 11/09/2026):
//  - El objetivo ya esta decidido: es la "Propuesta Nueva 2027" (AE:AH) de la
//    hoja "3. Obj Vacantes 26". No se reinventa aqui.
//  - Un "-" ahi significa que ese curso no corre en esa modalidad, no un cero:
//    queda vacio y la fila no lleva ni ventas ni consultas en ese bloque.
//  - Los 14 cursos que no figuran en esa hoja (los nuevos como N8N o CLAUDE IA,
//    y los que Planeamiento aun no propuso) heredan la MEDIANA de su
//    clasificacion TOP/NORMAL/BAJO segun el historico 2026. Es un piso
//    razonable, y va marcado para que se vea que no lo decidio nadie.
//  - Los nombres se cruzan sin el sufijo de version: "DIP SUPPLY V3" en Obj
//    Vacantes es "DIP SUPPLY" en Plan 2027 desde que se agruparon las versiones.
import fs from 'node:fs'
import assert from 'node:assert'

const CELDAS = ['APE_ALTA', 'APE_NORMAL', 'SEG_ALTA', 'SEG_NORMAL']

// Mediana de ventas por edicion del historico 2026, por clasificacion.
// Sale de promedio-ventas-apertura-seguimiento.mjs agrupado por CAT.
const MEDIANA_POR_CAT = {
  TOP: [19, 16, 17, 16],
  NORMAL: [14, 10, 7, 7],
  BAJO: [4, 3, 5, 3],
  NUEVO: [4, 3, 5, 3]
}

// "GEST PROYECT I" en Obj Vacantes es "GEST PROYECT" en Plan 2027.
const ALIAS = { 'GEST PROYECT I': 'GEST PROYECT' }

export const nombreDelPrograma = etiqueta => {
  const limpio = etiqueta.replace(/\s+V\d+$/i, '').trim()
  return ALIAS[limpio] ?? limpio
}

// En la hoja un guion es "no aplica"; cualquier otra cosa que no sea numero
// tampoco es un objetivo.
const objetivoDe = texto => {
  const n = Number(String(texto).trim())
  return Number.isFinite(n) && n > 0 ? n : null
}

const leerCsv = ruta => fs.readFileSync(ruta, 'utf8').split('\n').slice(1)
  .filter(l => l.trim()).map(l => l.split(';').map(c => c.trim()))

const propuesta = new Map()
for (const [programa, ...celdas] of leerCsv('scripts/obj-vacantes-2027.csv')) {
  propuesta.set(nombreDelPrograma(programa), celdas.map(objetivoDe))
}

const filas = leerCsv('scripts/plan2027-cursos.csv').map(([fila, programa, cat]) => {
  const propio = propuesta.get(nombreDelPrograma(programa))
  return {
    fila: Number(fila),
    programa,
    cat,
    fuente: propio ? 'Obj Vacantes 26' : 'mediana ' + cat,
    objetivos: propio ?? MEDIANA_POR_CAT[cat]
  }
})

{
  assert.equal(nombreDelPrograma('DIP SUPPLY V3'), 'DIP SUPPLY', 'el sufijo de version se va')
  assert.equal(nombreDelPrograma('GEST PROYECT I'), 'GEST PROYECT', 'el alias se aplica')
  assert.equal(objetivoDe('-'), null, 'el guion no es objetivo')
  assert.equal(objetivoDe('0'), null, 'un cero tampoco')
  assert.equal(objetivoDe('22'), 22)
  assert.equal(filas.length, 72, 'los 72 cursos de A11:A82')
  assert.ok(filas.every(f => f.objetivos), 'ningun curso se queda sin base')
}

console.log('FILA;PROGRAMA;CAT;FUENTE;' + CELDAS.join(';'))
for (const f of filas) {
  console.log([f.fila, f.programa, f.cat, f.fuente, ...f.objetivos.map(o => o ?? '')].join(';'))
}

const conDato = CELDAS.map((_, i) => filas.filter(f => f.objetivos[i]).length)
console.error(`\n-- ${filas.length} cursos | ${filas.filter(f => f.fuente.startsWith('mediana')).length} con mediana de su CAT`)
CELDAS.forEach((c, i) => console.error(`--  ${c.padEnd(11)} ${conDato[i]}/${filas.length}`))
