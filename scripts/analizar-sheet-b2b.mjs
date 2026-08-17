// Analiza el export markdown del Sheet "WE FOR BUSINESS" (el que reemplaza el
// modulo B2B). El export concatena todas las pestanas: cada una arranca con una
// fila separadora ':-:'. Uso:
//   node scripts/analizar-sheet-b2b.mjs <ruta-al-json> [n-tabla]
import { readFileSync } from 'node:fs'

const [rutaJson, tablaPedida] = process.argv.slice(2)
const contenido = JSON.parse(readFileSync(rutaJson, 'utf8')).fileContent
const lineas = contenido.split('\n')

const celdas = (linea) => linea.split('|').slice(1, -1).map(c => c.trim())

// Una tabla va desde la fila anterior a su separador hasta el separador siguiente.
const inicios = lineas.map((l, i) => (/:-:/.test(l) ? i : -1)).filter(i => i >= 0)
const tablas = inicios.map((inicio, n) => ({
  numero: n + 1,
  desde: inicio,
  hasta: (inicios[n + 1] ?? lineas.length) - 1,
}))

// El encabezado real no es la fila 0: las pestanas traen titulos y filas vacias
// arriba. Es la primera fila con mas de la mitad de celdas no vacias.
const buscarEncabezado = (t) => {
  for (let i = t.desde + 1; i < Math.min(t.desde + 8, t.hasta); i++) {
    const c = celdas(lineas[i])
    if (c.filter(Boolean).length > c.length / 2) return { fila: i, columnas: c }
  }
  return { fila: t.desde + 1, columnas: celdas(lineas[t.desde + 1]) }
}

for (const t of tablas) {
  if (tablaPedida && Number(tablaPedida) !== t.numero) continue
  const { fila, columnas } = buscarEncabezado(t)
  console.log(`\n══ TABLA ${t.numero}  lineas ${t.desde}-${t.hasta}  (${t.hasta - fila} filas de datos, ${columnas.length} columnas)`)
  columnas.forEach((c, i) => c && console.log(`   ${String(i).padStart(2)}. ${c}`))
  if (tablaPedida) {
    console.log('\n   ── primeras 3 filas de datos ──')
    for (let i = fila + 1; i <= Math.min(fila + 3, t.hasta); i++) {
      celdas(lineas[i]).forEach((v, j) => v && console.log(`   [${j}] ${columnas[j] || '?'} = ${v}`))
      console.log('   ---')
    }
  }
}
