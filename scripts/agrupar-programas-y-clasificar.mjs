// Agrupa la hoja "2. Clas. prog." por PROGRAMA (no por version) y reclasifica
// TOP / NORMAL / BAJO por nivel de ingresos.
//
// Reglas de negocio (Planeamiento, 10/09/2026):
//  - Un programa y sus versiones son el MISMO producto: "DIP GEST PROYECTOS V4"
//    y "V5" son una sola fila. Sin esto la hoja duplica el producto y lo parte
//    en dos filas chicas que caen ambas a BAJO.
//  - La clasificacion sale del ranking de ingresos, no de un monto fijo:
//    20% TOP, 40% NORMAL, 40% BAJO. Al ser percentil, sigue valiendo el ano que
//    viene aunque los montos suban.
//
// Ventas, ingresos y consultas se SUMAN al agrupar; la conversion se vuelve a
// calcular del total. Promediar los dos porcentajes daria un numero falso: una
// version con 1 venta pesaria igual que otra con 88.
import fs from 'node:fs'
import assert from 'node:assert/strict'

const RUTA_CSV = process.argv[2]
const PROPORCION = { TOP: 0.20, NORMAL: 0.40 }

// Solo el sufijo explicito " V<n>" es una version. "GEST PROYECT I" y
// "EXCEL AVANZ" son productos distintos, no versiones del mismo.
export const nombreDelPrograma = etiqueta => etiqueta.replace(/\s+V\d+$/i, '').trim()

const numero = texto => Number(String(texto).trim().replace(/\./g, '').replace(',', '.')) || 0

export function agruparPorPrograma (filas) {
  const grupos = new Map()
  for (const fila of filas) {
    const nombre = nombreDelPrograma(fila.programa)
    const grupo = grupos.get(nombre) ?? { programa: nombre, ventas: 0, ingresos: 0, consultas: 0, versiones: 0 }
    grupo.ventas += fila.ventas
    grupo.ingresos += fila.ingresos
    grupo.consultas += fila.consultas
    grupo.versiones++
    grupos.set(nombre, grupo)
  }
  return [...grupos.values()]
}

// Reparte por ranking de ingresos. El redondeo se aplica a TOP y NORMAL y BAJO
// se lleva el resto, asi la suma de los tres siempre da el total de programas.
export function clasificarPorIngresos (programas) {
  const ordenados = [...programas].sort((a, b) => b.ingresos - a.ingresos)
  const corteTop = Math.round(ordenados.length * PROPORCION.TOP)
  const corteNormal = corteTop + Math.round(ordenados.length * PROPORCION.NORMAL)
  return ordenados.map((p, i) => ({
    ...p,
    clasificacion: i < corteTop ? 'TOP' : i < corteNormal ? 'NORMAL' : 'BAJO'
  }))
}

{
  assert.equal(nombreDelPrograma('DIP GEST PROYECTOS V5'), 'DIP GEST PROYECTOS', 'el sufijo de version se va')
  assert.equal(nombreDelPrograma('GEST PROYECT I'), 'GEST PROYECT I', 'un numero romano no es una version')
  assert.equal(nombreDelPrograma('SAP HANA IN PRESENCIAL'), 'SAP HANA IN PRESENCIAL', 'sin sufijo no se toca')

  const juntos = agruparPorPrograma([
    { programa: 'DIP X V3', ventas: 14, ingresos: 9270, consultas: 179 },
    { programa: 'DIP X V4', ventas: 88, ingresos: 41038, consultas: 743 }
  ])
  assert.equal(juntos.length, 1, 'dos versiones son un solo programa')
  assert.equal(juntos[0].ventas, 102)
  assert.equal(juntos[0].consultas, 922, 'las consultas tambien se suman')

  const diez = clasificarPorIngresos(
    Array.from({ length: 10 }, (_, i) => ({ programa: `P${i}`, ingresos: (10 - i) * 1000 })))
  assert.equal(diez.filter(p => p.clasificacion === 'TOP').length, 2, '20% de 10 son 2')
  assert.equal(diez.filter(p => p.clasificacion === 'NORMAL').length, 4)
  assert.equal(diez.filter(p => p.clasificacion === 'BAJO').length, 4)
  assert.equal(diez[0].clasificacion, 'TOP', 'el de mas ingresos encabeza')
}

if (RUTA_CSV) {
  const filas = fs.readFileSync(RUTA_CSV, 'utf8').trim().split('\n').slice(1).map(linea => {
    const [programa, ventas, ingresos, consultas] = linea.split(';')
    return { programa: programa.trim(), ventas: numero(ventas), ingresos: numero(ingresos), consultas: numero(consultas) }
  })

  const programas = clasificarPorIngresos(agruparPorPrograma(filas))

  // Se emite en el ORDEN DE APARICION de la hoja, no alfabetico ni por ingresos:
  // la hoja agrupa los productos por familia (Power BI, Excel, Finanzas,
  // Logistica, Proyectos, SAP) y ese orden es de Planeamiento, no accidental.
  const orden = new Map(agruparPorPrograma(filas).map((p, i) => [p.programa, i]))
  const enOrden = [...programas].sort((a, b) => orden.get(a.programa) - orden.get(b.programa))

  console.log('PROGRAMA;VENTAS;INGRESOS;CLASIFICACION;CONSULTAS;VERSIONES')
  for (const p of enOrden) {
    console.log([p.programa, p.ventas, p.ingresos.toFixed(2), p.clasificacion, p.consultas, p.versiones].join(';'))
  }

  const resumen = nivel => {
    const del = programas.filter(p => p.clasificacion === nivel)
    const ventas = del.reduce((a, p) => a + p.ventas, 0)
    const consultas = del.reduce((a, p) => a + p.consultas, 0)
    const ingresos = del.reduce((a, p) => a + p.ingresos, 0)
    return { nivel, programas: del.length, ventas, consultas, ingresos, conversion: consultas ? ventas / consultas : 0 }
  }
  console.error(`\n-- ${filas.length} filas de la hoja -> ${programas.length} programas`)
  console.error('-- nivel      progr. ventas consultas conversion   ingresos')
  for (const nivel of ['TOP', 'NORMAL', 'BAJO']) {
    const r = resumen(nivel)
    console.error(`--  ${r.nivel.padEnd(9)} ${String(r.programas).padStart(4)} ${String(r.ventas).padStart(6)} ${String(r.consultas).padStart(9)} ${(r.conversion * 100).toFixed(1).padStart(9)}% ${r.ingresos.toLocaleString('es-PE').padStart(12)}`)
  }
  const fusionados = enOrden.filter(p => p.versiones > 1)
  console.error(`\n-- ${fusionados.length} programas se armaron juntando versiones:`)
  for (const p of fusionados) console.error(`--  ${p.programa} (${p.versiones})`)
}
