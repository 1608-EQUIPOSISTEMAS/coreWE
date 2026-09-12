// Promedio de DIAS entre una edicion y la siguiente del mismo curso: las cuatro
// columnas "Programacion Apertura/Seguimiento, Mes Alto/Normal" (C11:F82) de la
// hoja "1. Plan 2027". Responde "cada cuantos dias se programa este curso".
//
// Reglas de negocio (Planeamiento, 11/09/2026):
//  - Se mide entre ediciones del MISMO tipo: la cadencia de aperturas no se
//    mezcla con la de seguimientos. El tipo lo pone el mismo clasificador que
//    los promedios de ventas (lib/clasificacion-ediciones.mjs).
//  - El intervalo cuenta en la temporalidad de la edicion que ABRE al final:
//    marzo->abril es un curso programado en mes normal.
//  - Los nombres se agrupan por programa: DIP GEST PROYECTOS V4 -> V5 es la
//    misma cadencia, el cambio de version no reinicia el reloj.
//  - Una sola edicion de ese tipo no da intervalo: la celda queda vacia.
//  - Un intervalo de mas de PAUSA_MAXIMA_DIAS es una PAUSA, no el ritmo: POWER
//    BI abrio el 30/01 y la siguiente apertura fue el 18/06 (139 dias) porque
//    en medio corrio como seguimiento. Solo si el curso no tiene ningun
//    intervalo corto se promedian las pausas (ese curso de verdad es lento).
//  - Mes normal: tope de TOPE_MES_NORMAL_DIAS, pedido por el lider de Producto
//    (11/09/2026). Un curso que en la historia fue mas rapido conserva su numero.
//
// Entrada: el --detalle de promedio-ventas-apertura-seguimiento.mjs (ene-ago
// 2026, ya cuadrado contra cronograma y ERP) y la lista de paquetes.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { crearClasificador, nombreDelPrograma, temporalidad } from './lib/clasificacion-ediciones.mjs'

const CELDAS = ['APE_ALTA', 'APE_NORMAL', 'SEG_ALTA', 'SEG_NORMAL']
const MS_POR_DIA = 86_400_000
const PAUSA_MAXIMA_DIAS = 60
const TOPE_MES_NORMAL_DIAS = 40

const diasEntre = (desde, hasta) => (Date.parse(hasta) - Date.parse(desde)) / MS_POR_DIA

export function intervalosPorCelda (ediciones, clasificar) {
  const celdas = Object.fromEntries(CELDAS.map(c => [c, []]))
  const ultimaPorTipo = {}
  for (const edicion of [...ediciones].sort((a, b) => a.inicio.localeCompare(b.inicio))) {
    const tipo = clasificar(edicion) === 'SEGUIMIENTO' ? 'SEG' : 'APE'
    const anterior = ultimaPorTipo[tipo]
    if (anterior) celdas[`${tipo}_${temporalidad(edicion)}`].push(diasEntre(anterior.inicio, edicion.inicio))
    ultimaPorTipo[tipo] = edicion
  }
  return celdas
}

const promedio = valores => valores.reduce((a, b) => a + b, 0) / valores.length

export function diasDeProgramacion (intervalos, celda) {
  if (!intervalos.length) return ''
  const ritmo = intervalos.filter(d => d <= PAUSA_MAXIMA_DIAS)
  const dias = Math.round(promedio(ritmo.length ? ritmo : intervalos))
  return celda.endsWith('NORMAL') ? Math.min(dias, TOPE_MES_NORMAL_DIAS) : dias
}

{
  const clasificar = crearClasificador([])
  const c = intervalosPorCelda([
    { curso: 'X', inicio: '2026-04-10', segui: 0 },
    { curso: 'X', inicio: '2026-01-10', segui: 0 },
    { curso: 'X', inicio: '2026-02-09', segui: 5 },
    { curso: 'X', inicio: '2026-03-01', segui: 0 },
    { curso: 'X', inicio: '2026-05-09', segui: 5 }
  ], clasificar)
  assert.deepEqual(c.APE_ALTA, [50], 'ene->mar, sin contar el seguimiento de febrero')
  assert.deepEqual(c.APE_NORMAL, [40], 'mar->abr cuenta en el mes de la que abre')
  assert.deepEqual(c.SEG_NORMAL, [89], 'los seguimientos llevan su propio reloj')
  assert.equal(diasDeProgramacion([30, 31, 31], 'APE_ALTA'), 31)
  assert.equal(diasDeProgramacion([], 'APE_ALTA'), '', 'sin intervalo, celda vacia')
  assert.equal(diasDeProgramacion([26, 139], 'APE_ALTA'), 26, 'la pausa de 139 dias no es el ritmo')
  assert.equal(diasDeProgramacion([91, 177], 'APE_ALTA'), 134, 'si todo son pausas, el curso es lento')
  assert.equal(diasDeProgramacion([55, 58], 'APE_NORMAL'), 40, 'tope del mes normal')
  assert.equal(diasDeProgramacion([26], 'SEG_NORMAL'), 26, 'el curso rapido conserva su numero')
}

const [RUTA_DETALLE, RUTA_PAQUETES] = process.argv.slice(2)
const clasificar = crearClasificador(JSON.parse(fs.readFileSync(RUTA_PAQUETES, 'utf8')))

const edicionesPorPrograma = new Map()
for (const linea of fs.readFileSync(RUTA_DETALLE, 'utf8').split('\n').slice(1).filter(l => l.trim())) {
  const [curso, , inicio, , , , segui] = linea.split(';')
  const programa = nombreDelPrograma(curso)
  if (!edicionesPorPrograma.has(programa)) edicionesPorPrograma.set(programa, [])
  edicionesPorPrograma.get(programa).push({ curso, inicio, segui: Number(segui) })
}

const cursos = fs.readFileSync('scripts/plan2027-cursos.csv', 'utf8').split('\n').slice(1)
  .filter(l => l.trim()).map(l => l.split(';'))

console.log('FILA;PROGRAMA;' + CELDAS.join(';') + ';n')
for (const [fila, programa] of cursos) {
  const ediciones = edicionesPorPrograma.get(programa) ?? []
  const celdas = intervalosPorCelda(ediciones, clasificar)
  console.log([fila, programa, ...CELDAS.map(c => diasDeProgramacion(celdas[c], c)), ediciones.length].join(';'))
}
